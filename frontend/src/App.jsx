import React, { useEffect, useMemo, useState } from 'react'
import TruckViewer from './components/TruckViewer.jsx'
import { optimize, resetAll, runTests, simulateReplacing } from './services/api.js'

const MIN_STEP_MS = 16
const DEFAULT_STEP_MS = 80

function sanitizeDigits(raw) {
  return String(raw ?? '').replace(/[^0-9]/g, '')
}

function sanitizeDecimalDot(raw) {
  const cleaned = String(raw ?? '').replace(/[^0-9.,]/g, '')
  const normalized = cleaned.replace(/,/g, '.')
  const dot = normalized.indexOf('.')
  if (dot === -1) return normalized
  return normalized.slice(0, dot + 1) + normalized.slice(dot + 1).replace(/\./g, '')
}

function toMicro(value) {
  return Math.round(Number(value || 0) * 1e6)
}

function overlap1d(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

function overlapAreaXZ(top, bottom) {
  const overlapX = overlap1d(top.x, top.x + top.w, bottom.x, bottom.x + bottom.w)
  const overlapZ = overlap1d(top.z, top.z + top.d, bottom.z, bottom.z + bottom.d)
  return overlapX * overlapZ
}

function buildSupportAwareLoadOrder(placements) {
  const items = Array.isArray(placements) ? [...placements] : []
  const n = items.length
  const yEps = 1e-6
  const minSupportArea = 1e-10

  const rank = (box) => {
    const zBucket = Math.round(Number(box.z || 0) * 100)
    const serpentineFlip = (zBucket & 1) === 1
    return {
      z: toMicro(box.z),
      y: toMicro(box.y),
      x: toMicro(box.x),
      serpentineFlip,
      weight: Number(box.weight ?? -1),
      id: String(box.id ?? ''),
    }
  }

  const compareRank = (a, b) => {
    if (a.z !== b.z) return b.z - a.z
    if (a.y !== b.y) return a.y - b.y
    if (a.x !== b.x) return a.serpentineFlip ? (b.x - a.x) : (a.x - b.x)
    if (a.weight !== b.weight) return b.weight - a.weight
    return a.id.localeCompare(b.id)
  }

  const adjacency = Array.from({ length: n }, () => [])
  const inDegree = Array.from({ length: n }, () => 0)

  for (let topIndex = 0; topIndex < n; topIndex++) {
    const top = items[topIndex]
    if (Number(top.y || 0) <= yEps) continue

    for (let bottomIndex = 0; bottomIndex < n; bottomIndex++) {
      if (bottomIndex === topIndex) continue
      const bottom = items[bottomIndex]
      const bottomTopY = Number(bottom.y || 0) + Number(bottom.h || 0)
      if (Math.abs(bottomTopY - Number(top.y || 0)) > yEps) continue

      const supportArea = overlapAreaXZ(top, bottom)
      if (supportArea <= minSupportArea) continue

      adjacency[bottomIndex].push(topIndex)
      inDegree[topIndex] += 1
    }
  }

  const ranked = items.map(rank)
  const available = []
  for (let i = 0; i < n; i++) {
    if (inDegree[i] === 0) available.push(i)
  }

  const takeNext = () => {
    let bestPos = 0
    for (let i = 1; i < available.length; i++) {
      if (compareRank(ranked[available[i]], ranked[available[bestPos]]) < 0) bestPos = i
    }
    return available.splice(bestPos, 1)[0]
  }

  const orderedIndices = []
  while (available.length) {
    const current = takeNext()
    orderedIndices.push(current)
    for (const dependent of adjacency[current]) {
      inDegree[dependent] -= 1
      if (inDegree[dependent] === 0) available.push(dependent)
    }
  }

  if (orderedIndices.length !== n) {
    items.sort((a, b) => compareRank(rank(a), rank(b)))
    return items
  }

  return orderedIndices.map((i) => items[i])
}

/**
 * App-level workflow controller.
 *
 * Coordinates dataset generation, optimization, and playback.
 *
 * Keeps engine output immutable; animation only changes reveal order.
 */
export default function App() {
  const [truck, setTruck] = useState({ w: 2.4, h: 2.6, d: 12.0, max_weight: 12000 })
  const [truckInput, setTruckInput] = useState({ w: '2.4', h: '2.6', d: '12.0' })
  const [numSkus, setNumSkus] = useState(500)
  const [numSkusInput, setNumSkusInput] = useState('500')
  const [seed, setSeed] = useState(123)
  const [seedInput, setSeedInput] = useState('123')

  const [datasetId, setDatasetId] = useState(null)
  const [placed, setPlaced] = useState([])
  const [unplaced, setUnplaced] = useState([])
  const [metrics, setMetrics] = useState(null)

  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const [busy, setBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const [visibleCount, setVisibleCount] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS)
  const [stepMsInput, setStepMsInput] = useState(String(DEFAULT_STEP_MS))
  const [selected, setSelected] = useState(null)

  const params = useMemo(() => ({ population: 20, generations: 15, mutation_rate: 0.08, seed }), [seed])

  const placedView = useMemo(() => {
    return buildSupportAwareLoadOrder(placed)
  }, [placed])

  // Animation is for inspection; never show boxes before their supports.
  const selectedPlaced = useMemo(() => {
    if (!selected?.id) return null
    return (placedView || []).find((p) => p.id === selected.id) || null
  }, [placedView, selected])

  useEffect(() => {
    if (!isPlaying) return
    if (!placedView?.length) return
    if (visibleCount >= placedView.length) {
      setIsPlaying(false)
      return
    }

    const t = window.setTimeout(() => {
      setVisibleCount((c) => Math.min((placedView?.length || 0), c + 1))
    }, Math.max(MIN_STEP_MS, Number(stepMs) || DEFAULT_STEP_MS))

    return () => window.clearTimeout(t)
  }, [isPlaying, visibleCount, stepMs, placedView])

  async function onSimulate() {
    setBusy(true)
    setError('')
    setStatus('Generando dataset…')

    const prev = datasetId
    setDatasetId(null)
    setPlaced([])
    setUnplaced([])
    setMetrics(null)
    setVisibleCount(0)
    setIsPlaying(false)
    setSelected(null)

    try {
      const out = await simulateReplacing({ num_skus: numSkus, seed, truck, previous_dataset_id: prev })
      setDatasetId(out.dataset_id)
      setStatus('Dataset generado.')
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error generando dataset')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  async function onOptimize() {
    setBusy(true)
    setError('')
    setStatus('Optimizando…')
    try {
      const out = await optimize({ dataset_id: datasetId, truck, params })
      setPlaced(out.placed || [])
      setUnplaced(out.unplaced || [])
      setMetrics(out.metrics || null)
      setVisibleCount(0)
      setIsPlaying(true)
      setSelected(null)
      setStatus('Optimización finalizada.')
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error optimizando')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  async function onClear() {
    setBusy(true)
    setError('')
    setStatus('Borrando gemelo digital y dataset…')
    try {
      await resetAll()
      setDatasetId(null)
      setPlaced([])
      setUnplaced([])
      setMetrics(null)
      setVisibleCount(0)
      setIsPlaying(false)
      setSelected(null)
      setStatus('Borrado. Genera un dataset nuevo.')
    } catch (e) {
      setError(e?.response?.data?.message || e?.message || 'Error borrando')
      setStatus('')
    } finally {
      setBusy(false)
    }
  }

  async function onRunTests() {
    setTestBusy(true)
    try {
      const out = await runTests()
      setTestResult(out)
    } finally {
      setTestBusy(false)
    }
  }

  return (
    <div className="container">
      <h2>Logistics Optimizer Suite</h2>
      <div className="grid">
        <div className="card">
          <h3>Dashboard de Control</h3>

          <div className="row">
            <div style={{ flex: 1 }}>
              <label>Truck W (m)</label>
              <input
                inputMode="decimal"
                value={truckInput.w}
                onChange={(e) => {
                  const next = sanitizeDecimalDot(e.target.value)
                  setTruckInput((t) => ({ ...t, w: next }))
                  const n = Number.parseFloat(next)
                  if (Number.isFinite(n)) setTruck((prev) => ({ ...prev, w: n }))
                }}
                onBlur={() => {
                  const n = Number.parseFloat(truckInput.w)
                  if (Number.isFinite(n)) {
                    setTruck((prev) => ({ ...prev, w: n }))
                    setTruckInput((t) => ({ ...t, w: String(n) }))
                  } else {
                    setTruckInput((t) => ({ ...t, w: String(truck.w) }))
                  }
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Truck H (m)</label>
              <input
                inputMode="decimal"
                value={truckInput.h}
                onChange={(e) => {
                  const next = sanitizeDecimalDot(e.target.value)
                  setTruckInput((t) => ({ ...t, h: next }))
                  const n = Number.parseFloat(next)
                  if (Number.isFinite(n)) setTruck((prev) => ({ ...prev, h: n }))
                }}
                onBlur={() => {
                  const n = Number.parseFloat(truckInput.h)
                  if (Number.isFinite(n)) {
                    setTruck((prev) => ({ ...prev, h: n }))
                    setTruckInput((t) => ({ ...t, h: String(n) }))
                  } else {
                    setTruckInput((t) => ({ ...t, h: String(truck.h) }))
                  }
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Truck D (m)</label>
              <input
                inputMode="decimal"
                value={truckInput.d}
                onChange={(e) => {
                  const next = sanitizeDecimalDot(e.target.value)
                  setTruckInput((t) => ({ ...t, d: next }))
                  const n = Number.parseFloat(next)
                  if (Number.isFinite(n)) setTruck((prev) => ({ ...prev, d: n }))
                }}
                onBlur={() => {
                  const n = Number.parseFloat(truckInput.d)
                  if (Number.isFinite(n)) {
                    setTruck((prev) => ({ ...prev, d: n }))
                    setTruckInput((t) => ({ ...t, d: String(n) }))
                  } else {
                    setTruckInput((t) => ({ ...t, d: String(truck.d) }))
                  }
                }}
              />
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label>SKUs (simulación)</label>
              <input
                inputMode="numeric"
                value={numSkusInput}
                onChange={(e) => {
                  const next = sanitizeDigits(e.target.value)
                  setNumSkusInput(next)
                  if (next !== '') setNumSkus(Number.parseInt(next, 10))
                }}
                onBlur={() => {
                  if (numSkusInput === '') setNumSkusInput(String(numSkus))
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Seed</label>
              <input
                inputMode="numeric"
                value={seedInput}
                onChange={(e) => {
                  const next = sanitizeDigits(e.target.value)
                  setSeedInput(next)
                  if (next !== '') setSeed(Number.parseInt(next, 10))
                }}
                onBlur={() => {
                  if (seedInput === '') setSeedInput(String(seed))
                }}
              />
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button disabled={busy} onClick={onSimulate}>Generar Dataset</button>
            <button disabled={busy || !datasetId} onClick={onOptimize}>Optimizar</button>
            <button disabled={busy} onClick={onClear}>Borrar</button>
          </div>

          <div style={{ marginTop: 10, fontSize: 12 }}>
            {status ? <div>{status}</div> : null}
            {error ? <div style={{ color: 'crimson' }}>{error}</div> : null}
          </div>

          <div style={{ marginTop: 12, fontSize: 12 }}>
            <div>Dataset: {datasetId || '(none)'}</div>
            <div>Placed: {placed.length} | Unplaced: {unplaced.length}</div>
            <div>
              Utilization: {metrics ? (metrics.utilization * 100).toFixed(2) + '%' : '-'}
            </div>
          </div>

          <hr style={{ margin: '16px 0' }} />

          <h3>Monitor de Tests</h3>
          <div className="row">
            <button disabled={testBusy} onClick={onRunTests}>Ejecutar Tests</button>
            <div style={{ fontSize: 12 }}>
              {testResult ? `exit=${testResult.exit_code} (${testResult.duration_ms}ms)` : ''}
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <pre style={{ fontSize: 12 }}>{testResult ? (testResult.stdout || testResult.stderr) : ''}</pre>
          </div>
        </div>

        <div className="card">
          <h3>Gemelo Digital (3D)</h3>
          <div className="viewerWrap">
            <TruckViewer
              truck={truck}
              placed={placedView}
              visibleCount={visibleCount}
              selectedId={selected?.id || null}
              onSelect={setSelected}
            />
            {busy && status?.toLowerCase?.().includes('optimiz') ? (
              <div className="overlay" aria-label="Optimizando">
                <div className="spinner" />
                <div style={{ marginTop: 10, fontSize: 12 }}>Optimizando…</div>
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 10, fontSize: 12 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>Mostrando: {Math.min(visibleCount, placedView.length)} / {placedView.length}</div>
              <div>Modo: {isPlaying ? 'Reproduciendo' : 'Pausado'}</div>
            </div>
            <div style={{ marginTop: 6, color: '#555' }}>
              Orden de carga: fondo → puerta, apilando de abajo → arriba.
            </div>
            <div style={{ marginTop: 4, color: '#555' }}>
              Animación respeta soporte: una caja arriba aparece después de sus soportes.
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                disabled={!placedView.length || busy}
                onClick={() => { setIsPlaying(false); setVisibleCount(0); setSelected(null) }}
              >Reset</button>
              <button
                disabled={!placedView.length || busy}
                onClick={() => { setIsPlaying(false); setVisibleCount((c) => Math.max(0, c - 1)) }}
              >Prev</button>
              <button
                disabled={!placedView.length || busy}
                onClick={() => setIsPlaying((v) => !v)}
              >{isPlaying ? 'Pausa' : 'Play'}</button>
              <button
                disabled={!placedView.length || busy}
                onClick={() => { setIsPlaying(false); setVisibleCount((c) => Math.min(placedView.length, c + 1)) }}
              >Next</button>
              <div style={{ flex: 1, minWidth: 120 }}>
                <label>Velocidad (ms/paso)</label>
                <input
                  disabled={busy}
                  inputMode="numeric"
                  value={stepMsInput}
                  onChange={(e) => {
                    const next = sanitizeDigits(e.target.value)
                    setStepMsInput(next)
                    if (next !== '') setStepMs(Number.parseInt(next, 10))
                  }}
                  onBlur={() => {
                    if (stepMsInput === '') setStepMsInput(String(stepMs))
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Caja seleccionada</div>
              {selectedPlaced ? (
                <div className="kv">
                  <div><span>ID:</span> {selectedPlaced.id}</div>
                  <div><span>Peso:</span> {selectedPlaced.weight ?? '-'} </div>
                  <div><span>Prioridad:</span> {selectedPlaced.priority ?? '-'}</div>
                  <div><span>Dim (w×h×d):</span> {Number(selectedPlaced.w).toFixed(3)} × {Number(selectedPlaced.h).toFixed(3)} × {Number(selectedPlaced.d).toFixed(3)}</div>
                  <div><span>Pos (x,y,z):</span> {Number(selectedPlaced.x).toFixed(3)}, {Number(selectedPlaced.y).toFixed(3)}, {Number(selectedPlaced.z).toFixed(3)}</div>
                </div>
              ) : (
                <div style={{ color: '#555' }}>Click en una caja para ver sus datos.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
