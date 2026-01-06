"""HTTP facade for the native optimizer.

Keeps the backend thin and gives me a process boundary for timeouts/crashes.
"""

from __future__ import annotations

import os
from typing import Any

import engine_bindings
from flask import Flask, jsonify, request

app = Flask(__name__)

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 6000


@app.get("/health")
def health() -> Any:
    """Lightweight liveness probe for Docker/Compose and local dev."""
    return jsonify({"status": "ok"})


@app.post("/optimize")
def optimize() -> Any:
    """Optimize a packing instance.

    The heavy work is delegated to the native optimizer; this route keeps request/response
    small and focused so the backend can treat it like an RPC call.
    """
    payload = request.get_json(silent=True) or {}
    truck = payload.get("truck") or {}
    boxes = payload.get("boxes") or []
    params = payload.get("params") or {}

    try:
        out = engine_bindings.optimize(truck, boxes, params)
        return jsonify(out)
    except Exception as exc:
        app.logger.exception("Engine optimize failed")
        return jsonify({"error": "engine_error", "message": str(exc)}), 500


def main() -> None:
    host = os.environ.get("HOST", DEFAULT_HOST)
    port = int(os.environ.get("PORT", str(DEFAULT_PORT)))
    app.run(host=host, port=port)


if __name__ == "__main__":
    main()
