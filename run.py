"""
aCount — Application Entry Point
Run with: python run.py
"""

import os
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
    app.run(host="0.0.0.0", port=5000, debug=True)
