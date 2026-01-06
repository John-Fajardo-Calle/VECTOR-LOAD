import React, { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

const CAMERA_NEAR = 0.01
const CAMERA_FAR = 500
const PICK_VISIBLE_ONLY = true

/**
 * 3D viewer for a truck + its placements.
 *
 * Three.js objects are long-lived; keep them here to avoid recreating renderer/scene
 * on every React render.
 */
export default function TruckViewer({ truck, placed, visibleCount, selectedId, onSelect }) {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const cameraRef = useRef(null)
  const truckMeshRef = useRef(null)
  const boxGroupRef = useRef(null)
  const meshesRef = useRef([])
  const hoverHelperRef = useRef(null)
  const selectedHelperRef = useRef(null)
  const boxMaterialRef = useRef(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const pointerRef = useRef(new THREE.Vector2())
  const hoveredIdRef = useRef(null)
  const dimsRef = useRef({ w: 2.4, h: 2.6, d: 12.0 })
  const onSelectRef = useRef(onSelect)

  const dims = useMemo(() => {
    const w = Number(truck?.w || 2.4)
    const h = Number(truck?.h || 2.6)
    const d = Number(truck?.d || 12.0)
    return { w, h, d }
  }, [truck])

  dimsRef.current = dims

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    sceneRef.current = scene

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio || 1)
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, CAMERA_NEAR, CAMERA_FAR)
    camera.position.set(1, 1, 1)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.AmbientLight(0xffffff, 0.8))
    const dir = new THREE.DirectionalLight(0xffffff, 0.7)
    dir.position.set(1, 2, 1)
    scene.add(dir)

    const initialDims = dimsRef.current
    const truckGeom = new THREE.BoxGeometry(initialDims.w, initialDims.h, initialDims.d)
    const truckMat = new THREE.MeshBasicMaterial({ wireframe: true })
    const truckMesh = new THREE.Mesh(truckGeom, truckMat)
    truckMesh.position.set(initialDims.w / 2, initialDims.h / 2, initialDims.d / 2)
    scene.add(truckMesh)
    truckMeshRef.current = truckMesh

    const boxGroup = new THREE.Group()
    scene.add(boxGroup)
    boxGroupRef.current = boxGroup

    // Resize handling is owned here so the renderer stays in sync with the DOM size.

    const onResize = () => {
      if (!mountRef.current) return
      const m = mountRef.current
      renderer.setSize(m.clientWidth, m.clientHeight)
      camera.aspect = m.clientWidth / m.clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', onResize)

    const pick = (clientX, clientY) => {
      const el = renderer.domElement
      const rect = el.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * 2 - 1
      const y = -(((clientY - rect.top) / rect.height) * 2 - 1)
      pointerRef.current.set(x, y)
      raycasterRef.current.setFromCamera(pointerRef.current, camera)
      const meshes = PICK_VISIBLE_ONLY ? meshesRef.current.filter((m) => m.visible) : meshesRef.current
      const hits = raycasterRef.current.intersectObjects(meshes, false)
      return hits.length ? hits[0] : null
    }

    const setHover = (mesh) => {
      const scene = sceneRef.current
      if (!scene) return
      const prev = hoverHelperRef.current
      if (prev) {
        scene.remove(prev)
        prev.geometry?.dispose?.()
        prev.material?.dispose?.()
        hoverHelperRef.current = null
      }
      if (!mesh) return
      const helper = new THREE.BoxHelper(mesh, 0x000000)
      hoverHelperRef.current = helper
      scene.add(helper)
    }

    const onPointerMove = (ev) => {
      const hit = pick(ev.clientX, ev.clientY)
      const id = hit?.object?.userData?.id || null
      if (id === hoveredIdRef.current) return
      hoveredIdRef.current = id
      setHover(hit?.object || null)
    }

    const onPointerLeave = () => {
      if (hoveredIdRef.current === null) return
      hoveredIdRef.current = null
      setHover(null)
    }

    const onClick = (ev) => {
      const hit = pick(ev.clientX, ev.clientY)
      const id = hit?.object?.userData?.id || null
      const handler = onSelectRef.current
      if (typeof handler === 'function') {
        handler(id ? { id } : null)
      }
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)
    renderer.domElement.addEventListener('click', onClick)

    let raf = 0
    const animate = () => {
      raf = window.requestAnimationFrame(animate)
      controls.update()
      if (hoverHelperRef.current) hoverHelperRef.current.update()
      if (selectedHelperRef.current) selectedHelperRef.current.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      window.removeEventListener('resize', onResize)
      window.cancelAnimationFrame(raf)
      controls.dispose()

      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      renderer.domElement.removeEventListener('click', onClick)

      // Dispose geometries
      for (const mesh of meshesRef.current) {
        mesh.geometry?.dispose?.()
      }
      meshesRef.current = []

      if (boxMaterialRef.current) {
        boxMaterialRef.current.dispose()
        boxMaterialRef.current = null
      }

      truckGeom.dispose()
      truckMat.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)

      sceneRef.current = null
      cameraRef.current = null
      truckMeshRef.current = null
      boxGroupRef.current = null
      hoverHelperRef.current = null
      selectedHelperRef.current = null
      boxMaterialRef.current = null
    }
  }, [])

  useEffect(() => {
    const truckMesh = truckMeshRef.current
    const camera = cameraRef.current
    if (!truckMesh || !camera) return

    if (truckMesh.geometry) truckMesh.geometry.dispose()
    truckMesh.geometry = new THREE.BoxGeometry(dims.w, dims.h, dims.d)
    truckMesh.position.set(dims.w / 2, dims.h / 2, dims.d / 2)

    camera.position.set(dims.w * 0.8, dims.h * 1.3, dims.d * 0.6)
    camera.updateProjectionMatrix()
  }, [dims])

  useEffect(() => {
    const group = boxGroupRef.current
    if (!group) return

    for (const mesh of meshesRef.current) {
      group.remove(mesh)
      mesh.geometry?.dispose?.()
    }
    meshesRef.current = []

    if (boxMaterialRef.current) {
      boxMaterialRef.current.dispose()
      boxMaterialRef.current = null
    }

    const normalMat = new THREE.MeshNormalMaterial()
    boxMaterialRef.current = normalMat

    for (const b of placed || []) {
      const g = new THREE.BoxGeometry(b.w, b.h, b.d)
      const m = new THREE.Mesh(g, normalMat)
      m.position.set(b.x + b.w / 2, b.y + b.h / 2, b.z + b.d / 2)
      m.userData = { id: b.id }
      group.add(m)
      meshesRef.current.push(m)
    }
  }, [placed])

  useEffect(() => {
    const meshes = meshesRef.current
    const n = Math.max(0, Math.min(meshes.length, Number(visibleCount) || 0))
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].visible = i < n
    }
  }, [visibleCount, placed])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    const prev = selectedHelperRef.current
    if (prev) {
      scene.remove(prev)
      prev.geometry?.dispose?.()
      prev.material?.dispose?.()
      selectedHelperRef.current = null
    }

    if (!selectedId) return

    const mesh = meshesRef.current.find((m) => m.userData?.id === selectedId && m.visible)
    if (!mesh) return

    const helper = new THREE.BoxHelper(mesh, 0xffaa00)
    selectedHelperRef.current = helper
    scene.add(helper)
  }, [selectedId, visibleCount, placed])

  return <div ref={mountRef} className="viewer" />
}
