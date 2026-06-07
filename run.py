"""
aCount — Application Entry Point
Run with: python run.py
"""

import os
import sys

# Ensure the project root is on the Python path (fixes Windows / direct invocation)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app, db

config_name = os.getenv("FLASK_ENV", "development")
app = create_app(config_name)


@app.cli.command("init-db")
def init_db():
    """Create all database tables."""
    with app.app_context():
        db.create_all()
        print("Database tables created.")


@app.cli.command("drop-db")
def drop_db():
    """Drop all database tables (use with caution)."""
    with app.app_context():
        db.drop_all()
        print("Database tables dropped.")


if __name__ == "__main__":
    # Bind to localhost by default; debug follows the active config (off in prod).
    host = os.getenv("FLASK_RUN_HOST", "127.0.0.1")
    port = int(os.getenv("FLASK_RUN_PORT", "5000"))
    app.run(host=host, port=port, debug=app.config.get("DEBUG", False))