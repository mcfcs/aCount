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
    from app.routes.health import health_bp
    from app.routes.inventory import inventory_bp
    from app.routes.sales import sales_bp
    from app.routes.bank_transfers import bank_transfers_bp
    from app.routes.expenses import expenses_bp
    from app.routes.subscriptions import subscriptions_bp
    from app.routes.email_log import email_log_bp
    from app.routes.gmail import gmail_bp
    from app.routes.dashboard import dashboard_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(inventory_bp, url_prefix="/api/inventory")
    app.register_blueprint(sales_bp, url_prefix="/api/sales")
    app.register_blueprint(bank_transfers_bp, url_prefix="/api/bank-transfers")
    app.register_blueprint(expenses_bp, url_prefix="/api/expenses")
    app.register_blueprint(subscriptions_bp, url_prefix="/api/subscriptions")
    app.register_blueprint(email_log_bp, url_prefix="/api/email-log")
    app.register_blueprint(gmail_bp, url_prefix="/api/gmail")
    app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")

    # Start background Gmail poller (skip in testing)
    if app.config.get("GMAIL_POLLER_ENABLED", True) and not app.config.get("TESTING"):
        from app.gmail.poller import start_background_poller
        start_background_poller(app)

    return app