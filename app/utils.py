"""Shared helpers used across routes and the Gmail pipeline."""

import ipaddress
import socket
from urllib.parse import urlparse


def get_php_estimate_rate(default: float = 56.0) -> float:
    """Return the stored USD->PHP estimate rate (AppSetting), falling back to `default`.

    Used by all currency-conversion sites so they honour the rate configured in
    Settings instead of a hardcoded constant.
    """
    try:
        from app.models.models import AppSetting
        setting = AppSetting.query.get("php_estimate_rate")
        if setting is not None and setting.value is not None:
            rate = float(setting.value)
            if rate > 0:
                return rate
    except Exception:
        pass
    return float(default)


def safe_sort_column(model, sort_by, default):
    """Return ``model.<sort_by>`` only when it is a real mapped column, else ``default``.

    Prevents 500s / attribute abuse from ``?sort_by=<arbitrary attribute>``.
    """
    try:
        valid = {c.key for c in model.__table__.columns}
    except Exception:
        return default
    if sort_by in valid:
        return getattr(model, sort_by, default)
    return default


def assert_safe_public_url(url):
    """Validate a user-supplied URL is http(s) and resolves to a public address.

    Mitigates SSRF by blocking localhost, private, link-local (e.g. cloud
    metadata at 169.254.169.254), reserved and multicast targets. Returns the
    parsed URL on success; raises ``ValueError`` otherwise.
    """
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("URL must start with http:// or https://.")
    host = parsed.hostname
    if not host:
        raise ValueError("URL host is missing.")
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise ValueError("URL host could not be resolved.") from exc
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ValueError("URL points to a disallowed (internal) address.")
    return parsed
