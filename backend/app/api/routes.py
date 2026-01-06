from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

import requests
from flask import Blueprint, current_app, jsonify, request

from ..core.simulator import generate_skus, generate_truck

api = Blueprint("api", __name__)

ENGINE_TIMEOUT_S = 300
DATASET_PREFIX = "dataset_"
DATASET_SUFFIX = ".json"
DATASET_PREVIEW_SIZE = 25


def _bad_request(message: str, **details: Any) -> tuple[Any, int]:
    payload: dict[str, Any] = {"error": "invalid_request", "message": message}
    if details:
        payload["details"] = details
    return jsonify(payload), 400


def _data_dir() -> Path:
    """Return the dataset directory, creating it if needed."""
    data_dir = Path(current_app.config["DATA_DIR"])
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir


def _dataset_path(dataset_id: str) -> Path:
    """Build the absolute path for a dataset id within the configured DATA_DIR."""
    return _data_dir() / f"{dataset_id}{DATASET_SUFFIX}"


def _safe_unlink(path: Path) -> bool:
    """Delete a file if it is a direct child of DATA_DIR.

    Guardrails: this endpoint is exposed to the UI, so path traversal must not
    be possible even if a client sends a malicious dataset id.
    """
    try:
        if path.exists() and path.is_file() and path.parent == _data_dir():
            path.unlink()
            return True
    except OSError:
        current_app.logger.warning("Failed to delete file: %s", path)
    return False


def _load_dataset(dataset_id: str) -> dict[str, Any] | None:
    """Load a dataset JSON file by id.

    Returns None if the dataset doesn't exist or can't be parsed.
    """
    path = _dataset_path(dataset_id)
    if not path.exists():
        return None
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except OSError:
        current_app.logger.exception("Failed to read dataset: %s", path)
        return None
    except json.JSONDecodeError:
        current_app.logger.exception("Invalid JSON dataset: %s", path)
        return None


def _save_dataset(dataset_id: str, truck: dict[str, Any], skus: list[dict[str, Any]]) -> None:
    """Persist a dataset JSON file.

    Raises:
        OSError: if the dataset can't be written.
    """
    path = _dataset_path(dataset_id)
    with path.open("w", encoding="utf-8") as f:
        json.dump({"truck": truck, "skus": skus}, f)


def _engine_base_url() -> str:
    """Return the configured engine base URL without a trailing slash."""
    return str(current_app.config["ENGINE_URL"]).rstrip("/")


def _post_engine_optimize(
    truck: dict[str, Any], boxes: list[Any], params: dict[str, Any]
) -> requests.Response:
    """Call the engine optimize endpoint.

    Raises:
        requests.RequestException: for network failures.
        requests.Timeout: on timeout.
    """
    return requests.post(
        f"{_engine_base_url()}/optimize",
        json={"truck": truck, "boxes": boxes, "params": params},
        timeout=int(current_app.config.get("ENGINE_TIMEOUT_S", 300)),
    )


def _enrich_placements(payload_boxes: list[Any], response_body: Any) -> Any:
    """Attach input box metadata to engine placements for UI inspection.

    The engine intentionally keeps its output minimal; the UI needs weight/priority
    to show details on click without storing a second copy of the dataset.
    """
    if not isinstance(response_body, dict):
        return response_body
    placed = response_body.get("placed")
    if not isinstance(placed, list) or not isinstance(payload_boxes, list):
        return response_body

    by_id: dict[str, Any] = {}
    for box in payload_boxes:
        if not isinstance(box, dict):
            continue
        box_id = box.get("id") or box.get("sku")
        if box_id:
            by_id[str(box_id)] = box

    enriched: list[Any] = []
    for placement in placed:
        if not isinstance(placement, dict):
            enriched.append(placement)
            continue
        placement_id = placement.get("id")
        meta = by_id.get(str(placement_id)) if placement_id is not None else None
        if not meta:
            enriched.append(placement)
            continue
        enriched.append(
            {
                **placement,
                "weight": meta.get("weight"),
                "priority": meta.get("priority"),
                "sku": meta.get("sku"),
                "original": {"w": meta.get("w"), "h": meta.get("h"), "d": meta.get("d")},
            }
        )

    response_body["placed"] = enriched
    return response_body


@api.get("/health")
def health() -> Any:
    """Health probe for container orchestration and uptime checks.

    Request:
        No body.

    Response (200):
        `{"status": "ok"}`

    Failure modes:
        None by design.

    Auth:
        None.
    """
    return jsonify({"status": "ok"})


@api.post("/api/simulate")
def simulate() -> Any:
    """Generate a synthetic dataset and persist it for later optimization.

    Request (JSON):
        - `num_skus` (int, optional): number of SKUs (default: 10_000)
        - `seed` (optional): RNG seed (passed through)
        - `truck` (object, optional): `{w, h, d, max_weight}`; missing fields use defaults
        - `previous_dataset_id` (str, optional): best-effort cleanup of a previous dataset

    Response (200):
        `{"dataset_id", "truck", "count", "preview"}`

    Failure modes:
        - 400 `invalid_request` if `num_skus` is not a valid integer.

    Auth:
        None.
    """
    payload = request.get_json(silent=True) or {}

    try:
        num_skus = int(payload.get("num_skus", 10_000))
    except (TypeError, ValueError):
        return _bad_request("num_skus must be an integer", num_skus=payload.get("num_skus"))

    if num_skus <= 0:
        return _bad_request("num_skus must be > 0", num_skus=num_skus)

    seed = payload.get("seed")

    previous_dataset_id = payload.get("previous_dataset_id")

    skus = generate_skus(num_skus=num_skus, seed=seed)
    truck = generate_truck(payload.get("truck"))

    if previous_dataset_id:
        # Keeps disk usage stable during iterative experimentation.
        _safe_unlink(_dataset_path(str(previous_dataset_id)))

    dataset_id = f"{DATASET_PREFIX}{time.time_ns()}"
    sku_dicts = [asdict(s) for s in skus]
    _save_dataset(dataset_id=dataset_id, truck=truck, skus=sku_dicts)

    return jsonify(
        {
            "dataset_id": dataset_id,
            "truck": truck,
            "count": len(skus),
            "preview": [asdict(s) for s in skus[:DATASET_PREVIEW_SIZE]],
        }
    )


@api.post("/api/optimize")
def optimize() -> Any:
    """Optimize a packing plan by proxying to the engine.

    Request (JSON):
        Supports two modes:
        - Dataset-backed: `{dataset_id, params?}`
        - Ad-hoc: `{truck?, boxes, params?}`

    Response (200 on success):
        Engine JSON response (typically `placed`, `unplaced`, `metrics`).

        Note: `placed` may be enriched with input metadata (`weight`, `priority`, `sku`,
        `original`) so the UI can show details without reloading the dataset.

    Failure modes:
        - 400 `invalid_request` if `boxes` is not an array or `params` is not an object.
        - 404 `dataset_not_found` when `dataset_id` doesn't exist under `DATA_DIR`.
        - 502 `engine_unreachable` on connection errors to the engine.
        - 504 `engine_timeout` when the engine exceeds `ENGINE_TIMEOUT_S`.
        - Other status codes are forwarded from the engine.

    Auth:
        None.
    """
    payload = request.get_json(silent=True) or {}

    dataset_id = payload.get("dataset_id")
    if dataset_id:
        dataset = _load_dataset(str(dataset_id))
        if dataset is None:
            return jsonify({"error": "dataset_not_found", "dataset_id": dataset_id}), 404
        truck = dataset["truck"]
        boxes = dataset["skus"]
    else:
        truck = generate_truck(payload.get("truck"))
        boxes = payload.get("boxes") or []

    if not isinstance(boxes, list):
        return _bad_request("boxes must be a JSON array")

    params = payload.get("params") or {}

    if not isinstance(params, dict):
        return _bad_request("params must be a JSON object")

    try:
        resp = _post_engine_optimize(truck=truck, boxes=boxes, params=params)
    except requests.exceptions.Timeout:
        return (
            jsonify(
                {
                    "error": "engine_timeout",
                    "message": (
                        "El engine tardó demasiado en responder. "
                        "Prueba con menos SKUs o parámetros GA menores."
                    ),
                }
            ),
            504,
        )
    except requests.exceptions.RequestException as e:
        # For the UI: distinguish network failures from optimization failures.
        return jsonify({"error": "engine_unreachable", "message": str(e)}), 502

    try:
        body = resp.json()
    except ValueError:
        body = {"error": "engine_bad_response", "status_code": resp.status_code, "text": resp.text}

    try:
        body = _enrich_placements(payload_boxes=boxes, response_body=body)
    except Exception:
        current_app.logger.exception("Failed to enrich placements")

    return jsonify(body), resp.status_code


@api.post("/api/reset")
def reset() -> Any:
    """Delete all dataset JSON files from `DATA_DIR`.

    Request:
        No body.

    Response (200):
        `{"status": "ok", "deleted": <int>}`

    Failure modes:
        None by design. Individual file failures are logged; the response is best-effort.

    Auth:
        None.
    """
    data_dir = _data_dir()
    deleted = 0
    for path in data_dir.glob(f"{DATASET_PREFIX}*{DATASET_SUFFIX}"):
        try:
            if path.is_file() and path.parent == data_dir:
                path.unlink()
                deleted += 1
        except OSError:
            current_app.logger.warning("Failed to delete file: %s", path)

    return jsonify({"status": "ok", "deleted": deleted})


@api.post("/api/tests/run")
def run_tests() -> Any:
    """Run pytest inside the backend container.

    Request:
        No body.

    Response (200 when enabled):
        `{"exit_code", "duration_ms", "stdout", "stderr"}`

    Failure modes:
        - 404 when disabled (default in production).
        - When enabled, test failures are reported via `exit_code` + captured output.

    Auth:
        None.
    """
    if not bool(current_app.config.get("ENABLE_TEST_ENDPOINT")):
        return jsonify({"error": "not_found"}), 404

    cmd = [
        os.environ.get("PYTEST", "python"),
        "-m",
        "pytest",
        "-q",
        "tests",
    ]

    started = time.time()
    env = os.environ.copy()
    env.setdefault("ENGINE_URL", current_app.config["ENGINE_URL"])
    env.setdefault("BACKEND_URL", "http://localhost:5000")
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    duration_ms = int((time.time() - started) * 1000)

    return jsonify(
        {
            "exit_code": proc.returncode,
            "duration_ms": duration_ms,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    )
