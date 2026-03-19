"""
Timezone helpers for this app.

The application stores timestamps as naive datetimes in the DB, but business logic
expects "local" time to be Manila/GMT+8.
"""

from datetime import datetime, timezone, timedelta

PH_TIMEZONE = timezone(timedelta(hours=8), "GMT+8")


def now() -> datetime:
    """
    Return a timezone-aware Manila datetime converted to naive local time.
    """
    return datetime.now(PH_TIMEZONE).replace(tzinfo=None)


def date_today() -> "datetime.date":
    """
    Return Manila local date.
    """
    return now().date()

