"""
aCount - Flask Application Factory
"""

import hmac
import os

from flask import Flask, request, jsonify
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

    # Fail fast on insecure production configuration.
    if config_name == "production":
        if app.config.get("SECRET_KEY") in (None, "", "dev-secret-change-in-production"):
            raise RuntimeError("SECRET_KEY must be set to a strong, unique value in production.")
        if not app.config.get("SQLALCHEMY_DATABASE_URI"):
            raise RuntimeError("DATABASE_URL must be set in production.")
        if not app.config.get("API_KEY"):
            raise RuntimeError("API_KEY must be set in production — without it every /api endpoint is public.")

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)

    # CORS — restrict browser access to the configured frontend origin(s).
    # Expose the headers the Labels PDF download needs to read client-side.
    origins = [o.strip() for o in str(app.config.get("CORS_ORIGINS", "")).split(",") if o.strip()]
    CORS(
        app,
        resources={r"/api/*": {"origins": origins or "*"}},
        expose_headers=["Content-Disposition", "X-Labels-Skipped"],
    )

    # Optional API-key gate on every /api/* route. When API_KEY is unset the
    # API stays open (local-dev convenience) but we warn loudly.
    api_key = app.config.get("API_KEY")
    if api_key:
        @app.before_request
        def _require_api_key():
            if request.method == "OPTIONS" or not request.path.startswith("/api/"):
                return None
            # Shoe images are rendered via <img> tags, which cannot send the
            # X-API-Key header; they are non-sensitive, so exempt GETs.
            if request.method == "GET" and request.path.startswith("/api/shoes/image/"):
                return None
            if not hmac.compare_digest(request.headers.get("X-API-Key", ""), api_key):
                return jsonify({"error": "Unauthorized"}), 401
    elif not app.config.get("TESTING"):
        app.logger.warning(
            "API_KEY is not set — /api endpoints are UNAUTHENTICATED. "
            "Set API_KEY (and VITE_API_KEY in the frontend) to require a key."
        )

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
    from app.routes.settings import settings_bp
    from app.routes.shoes import shoes_bp
    from app.routes.labels import labels_bp
    from app.routes.barcodes import barcodes_bp
    from app.routes.push import push_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(inventory_bp, url_prefix="/api/inventory")
    app.register_blueprint(sales_bp, url_prefix="/api/sales")
    app.register_blueprint(bank_transfers_bp, url_prefix="/api/bank-transfers")
    app.register_blueprint(expenses_bp, url_prefix="/api/expenses")
    app.register_blueprint(subscriptions_bp, url_prefix="/api/subscriptions")
    app.register_blueprint(email_log_bp, url_prefix="/api/email-log")
    app.register_blueprint(gmail_bp, url_prefix="/api/gmail")
    app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
    app.register_blueprint(shoes_bp, url_prefix="/api/shoes")
    app.register_blueprint(labels_bp, url_prefix="/api/labels")
    app.register_blueprint(barcodes_bp, url_prefix="/api/barcodes")
    app.register_blueprint(push_bp, url_prefix="/api/push")

    # JSON error responses so the API never returns HTML error pages.
    from werkzeug.exceptions import HTTPException

    @app.errorhandler(HTTPException)
    def _handle_http_exception(exc):
        return jsonify({"error": exc.description, "code": exc.code}), exc.code

    @app.errorhandler(Exception)
    def _handle_unexpected(exc):
        # In debug, Flask re-raises so the debugger still works; in production
        # this returns a clean JSON 500 instead of an HTML stack trace.
        app.logger.exception("Unhandled application error")
        return jsonify({"error": "Internal server error"}), 500

    # Start background Gmail poller (skip in testing).
    # In debug, the Werkzeug reloader runs two processes; only the serving
    # child (WERKZEUG_RUN_MAIN=true) gets a poller — the parent starting one
    # too caused duplicate polls (and would double-send push notifications).
    # This also keeps `flask db ...` CLI invocations poller-free.
    poller_process = (not app.debug) or os.environ.get("WERKZEUG_RUN_MAIN") == "true"
    if app.config.get("GMAIL_POLLER_ENABLED", True) and not app.config.get("TESTING") and poller_process:
        from app.gmail.poller import start_background_poller
        start_background_poller(app)

    return app
