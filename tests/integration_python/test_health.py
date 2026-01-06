import os

import requests


def test_backend_health():
    # Scenario: backend is running and responds to the health probe used by Compose/UI.
    base = os.environ.get("BACKEND_URL", "http://localhost:5000").rstrip("/")
    r = requests.get(f"{base}/health", timeout=10)
    assert r.status_code == 200
    assert r.json().get("status") == "ok"
