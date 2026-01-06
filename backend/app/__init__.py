"""Backend application factory.

Configuration comes from environment variables so the same image can run in dev/CI/prod.
"""

from __future__ import annotations

import os

from flask import Flask
from flask_cors import CORS

from .api.routes import api


def create_app() -> Flask:
    """Create and configure the Flask app.

    Loads config from the environment, enables CORS (restrict via `CORS_ORIGINS` in prod),
    then registers routes.
    """
    app = Flask(__name__)

    # Configuration is environment-driven so Compose/local/CI can swap dependencies
    # without code changes.
    app.config["ENGINE_URL"] = os.environ.get("ENGINE_URL", "http://engine:6000")
    app.config["DATA_DIR"] = os.environ.get("DATA_DIR", "/app/data")

    app.config["ENGINE_TIMEOUT_S"] = int(os.environ.get("ENGINE_TIMEOUT_S", "300"))
    app.config["ENABLE_TEST_ENDPOINT"] = os.environ.get("ENABLE_TEST_ENDPOINT", "0").strip() in {
        "1",
        "true",
        "True",
        "yes",
        "YES",
    }

    cors_origins = os.environ.get("CORS_ORIGINS")
    if cors_origins:
        origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
        CORS(app, origins=origins)
    else:
        CORS(app)

    app.register_blueprint(api, url_prefix="")

    return app
