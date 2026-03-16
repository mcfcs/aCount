"""
aCount - Flask Application Factory
"""

from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_cors import CORS

db = SQLAlchemy()
migrate = Migrate()


def create_app(config_name="development"):
    """Create and configure the Flask application."""
    from app.config import config_by_name

    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    CORS(app)

    # Import models so they're registered with SQLAlchemy
    from app.models import models  # noqa: F401

    # Register blueprints
    from app.routes.inventory import inventory_bp
    from app.routes.sales import sales_bp
    from app.routes.health import health_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(inventory_bp, url_prefix="/api/inventory")
    app.register_blueprint(sales_bp, url_prefix="/api/sales")

    return app