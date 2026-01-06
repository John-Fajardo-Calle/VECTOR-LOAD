import os

import requests


def test_optimize_smoke():
    engine = os.environ.get("ENGINE_URL", "http://localhost:6000").rstrip("/")

    # Scenario: minimal end-to-end contract — engine accepts a small payload and returns
    # the expected top-level keys for downstream consumers.
    payload = {
        "truck": {"w": 2.4, "h": 2.6, "d": 6.0, "max_weight": 1000},
        "boxes": [
            {"id": "A", "w": 0.5, "h": 0.5, "d": 0.5, "weight": 2, "priority": 2},
            {"id": "B", "w": 0.6, "h": 0.4, "d": 0.7, "weight": 3, "priority": 1},
        ],
        "params": {"population": 10, "generations": 5, "mutation_rate": 0.1, "seed": 7},
    }
    r = requests.post(f"{engine}/optimize", json=payload, timeout=60)
    assert r.status_code == 200
    data = r.json()
    assert "placed" in data
    assert "metrics" in data
