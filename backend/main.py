"""Backend entrypoint.

Reads bind settings from `HOST`/`PORT`. Container deployments use Gunicorn via
`backend/wsgi.py`; this module is mainly for local runs.
"""

from __future__ import annotations

import os

from app import create_app


def main() -> None:
    """Start the Flask dev server for local runs."""
    app = create_app()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5000"))
    app.run(host=host, port=port)


if __name__ == "__main__":
    main()
