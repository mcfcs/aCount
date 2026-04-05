"""
One-time Gmail OAuth 2.0 setup script.
Run this once to obtain a refresh token, then add it to .env.

Usage:
    python setup_oauth.py

Requirements:
    pip install google-auth-oauthlib

Steps:
    1. Create a Google Cloud project and enable the Gmail API.
    2. Create OAuth 2.0 credentials (Desktop app type).
    3. Download the credentials JSON and set GMAIL_CLIENT_ID and
       GMAIL_CLIENT_SECRET in your .env (or pass them below).
    4. Run this script — it opens a browser for consent.
    5. Copy the printed refresh token into .env as GMAIL_REFRESH_TOKEN.
"""

import os
from google_auth_oauthlib.flow import InstalledAppFlow
from dotenv import load_dotenv

load_dotenv()

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

CLIENT_ID = os.getenv("GMAIL_CLIENT_ID")
CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET")

if not CLIENT_ID or not CLIENT_SECRET:
    raise SystemExit(
        "ERROR: GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env\n"
        "Create OAuth 2.0 credentials in Google Cloud Console first."
    )

client_config = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "redirect_uris": ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"],
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
    }
}

flow = InstalledAppFlow.from_client_config(client_config, scopes=SCOPES)
creds = flow.run_local_server(
    port=0,
    access_type="offline",
    prompt="consent",
)

print("\n" + "=" * 60)
print("OAuth setup complete!")
print("=" * 60)
print(f"\nRefresh token:\n  {creds.refresh_token}")
print("\nAdd this to your .env file:")
print(f"  GMAIL_REFRESH_TOKEN={creds.refresh_token}")
print("=" * 60)
