"""
Gmail OAuth 2.0 authentication.
Spec: Section 3.5

Uses a stored refresh token from the environment. Run setup_oauth.py once
to obtain the initial refresh token, then store it in .env.
"""

import os
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
]


def get_gmail_service():
    """
    Build and return an authenticated Gmail API service.
    Auto-refreshes the access token using the stored refresh token.
    Raises RuntimeError if credentials are missing or refresh fails.
    """
    client_id = os.getenv("GMAIL_CLIENT_ID")
    client_secret = os.getenv("GMAIL_CLIENT_SECRET")
    refresh_token = os.getenv("GMAIL_REFRESH_TOKEN")

    if not all([client_id, client_secret, refresh_token]):
        raise RuntimeError(
            "Gmail credentials missing. Set GMAIL_CLIENT_ID, "
            "GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in .env"
        )

    creds = Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_id,
        client_secret=client_secret,
        scopes=SCOPES,
    )

    # Refresh to get a valid access token
    creds.refresh(Request())

    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def check_connection():
    """
    Verify Gmail API connectivity. Returns (True, email) or (False, error_msg).
    """
    try:
        service = get_gmail_service()
        profile = service.users().getProfile(userId="me").execute()
        return True, profile.get("emailAddress", "unknown")
    except Exception as e:
        return False, str(e)
