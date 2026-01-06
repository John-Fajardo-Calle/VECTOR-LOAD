import os

import requests


def _engine_url() -> str:
    # Integration tests run against a real engine service; allow CI/Compose to override.
    return os.environ.get("ENGINE_URL", "http://localhost:6000").rstrip("/")


def test_support_ratio_blocks_overhang():
    engine = _engine_url()

    # Scenario: prevent unstable stacking when the contact area is insufficient.
    payload = {
        # Constraint: truck height only allows the intended stacking orientation so the
        # test exercises the support rule rather than alternate rotations.
        "truck": {"w": 2.0, "h": 0.85, "d": 1.0, "max_weight": 1000},
        "boxes": [
            {"id": "support", "w": 1.0, "h": 0.65, "d": 1.0, "weight": 50, "priority": 1},
            {"id": "top", "w": 2.0, "h": 0.2, "d": 1.0, "weight": 1, "priority": 1},
        ],
        "params": {"population": 8, "generations": 4, "mutation_rate": 0.1, "seed": 1},
    }

    r = requests.post(f"{engine}/optimize", json=payload, timeout=60)
    assert r.status_code == 200
    data = r.json()

    assert "top" in data["unplaced"]


def test_crush_blocks_heavy_on_light():
    engine = _engine_url()

    # Scenario: reject placements that would exceed the support box crush capacity.
    payload = {
        "truck": {"w": 2.0, "h": 0.85, "d": 1.0, "max_weight": 1000},
        "boxes": [
            {"id": "base", "w": 2.0, "h": 0.65, "d": 1.0, "weight": 1, "priority": 1},
            {"id": "heavy_top", "w": 2.0, "h": 0.2, "d": 1.0, "weight": 10, "priority": 1},
        ],
        "params": {"population": 8, "generations": 4, "mutation_rate": 0.1, "seed": 2},
    }

    r = requests.post(f"{engine}/optimize", json=payload, timeout=60)
    assert r.status_code == 200
    data = r.json()

    assert "heavy_top" in data["unplaced"]
