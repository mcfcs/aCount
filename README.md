# aCount

Sneaker resale accounting and financial management system with a Flask API and a React frontend.

## Repository Structure

- `app/` — Flask application, database models, API routes, and Gmail processing logic
- `frontend/` — React + Vite UI
- `migrations/` — Alembic migrations
- `run.py` — backend entry point and CLI helpers
- `setup_oauth.py` — one-time Gmail OAuth refresh-token setup script

## Core Capabilities

- Inventory tracking for sneaker pairs
- Sales lifecycle management (pending → confirmed → shipped → completed/cancelled)
- Bank transfer recording and allocation to sales
- Expense and subscription tracking
- Dashboard summaries and financial reporting
- Gmail ingestion + parsing pipeline with processing logs
- Shoe catalog with image support
- Shipping label hub: compiles prepaid label PDFs from Alias confirmation emails and merges selected ones into a single 2-up (label + QR per page) print-ready PDF
- Barcode scanning: scan the UPC/EAN on a shoe box (camera or photo upload) to look up brand/name/size and add the pair to inventory after confirmation

## Barcode Scanning

Open **Inventory → Scan Barcode**. Point the camera at the UPC/EAN barcode on the box label, upload a photo of it, or type the number. The app looks the code up and shows a popup with the shoe's details (brand, name, size, style code, product image) for you to verify — confirming adds the pair to inventory.

How lookups resolve:

1. **Local `product_barcodes` table** — every confirmed scan is remembered, so rescanning a barcode you've added before is instant and offline.
2. **[UPCitemdb](https://www.upcitemdb.com/)** — keyless free trial tier (~100 lookups/day per IP). Set `UPCITEMDB_API_KEY` in `.env` to use the paid tier. Codes that aren't indexed (common for region-exclusive releases) fall back to manual entry in the same popup, and are remembered once confirmed.

Camera notes:

- On the dev machine, `http://localhost:5173` works as-is (localhost is a secure context).
- To scan **from a phone**, browsers require HTTPS: start the frontend with `VITE_HTTPS=1` (e.g. PowerShell: `$env:VITE_HTTPS='1'; npm run dev`) and open the `https://<LAN-IP>:5173` URL shown by Vite, accepting the self-signed certificate warning.
- Photo upload works everywhere without HTTPS. Use JPG/PNG (browsers can't decode HEIC outside Safari).

## Push Notifications

Enable under **Settings → Push Notifications** ("Enable on this device"), then use "Send test notification" to verify. Notifications are sent by the backend's background poller:

- **Lifecycle events** (as Alias emails are ingested): new sale, confirmed (with ship-by), shipped, completed/cash-out, buyer-accepted discount, cancelled (+fee), payout received (flagged when it couldn't auto-reconcile), attention-needed.
- **Deadline alerts** (scanned every poll interval): sale pending >12h, shipment deadline at T-24h and T-6h, overdue shipment, and the attention-needed 48h auto-discount timer (on appearance and at T-6h).

Each event/stage sends **once** — delivery is deduplicated in the `push_sent_log` table, so restarts and re-scrapes never double-notify.

Setup: VAPID keys live in `.env` (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`); push stays disabled until they're set. Delivery requires the site to be served over HTTPS with a certificate the phone trusts (e.g. `tailscale serve`) — the self-signed `VITE_HTTPS=1` cert is enough for the camera but **not** for push on phones. On iPhone, install the app to the Home Screen first (iOS only grants web push to installed PWAs).

## Tech Stack

### Backend

- Python + Flask
- SQLAlchemy + Flask-Migrate (Alembic)
- PostgreSQL (default dev database)
- Gmail API integrations (`google-auth`, `google-api-python-client`)

### Frontend

- React (Vite)
- React Router
- Axios
- Recharts
- ESLint

## Prerequisites

- Python 3.11+ (recommended)
- Node.js 18+ and npm
- PostgreSQL (for local development)

## Environment Setup

1. Copy `.env.example` to `.env`.
2. Fill required values such as:
   - `DATABASE_URL`
   - `SECRET_KEY`
   - Gmail OAuth values if using Gmail ingestion:
     - `GMAIL_CLIENT_ID`
     - `GMAIL_CLIENT_SECRET`
     - `GMAIL_REFRESH_TOKEN`

## Backend Setup

Run from the repository root:

```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

Backend default URL: `http://localhost:5000`

Health endpoint:

```bash
curl http://localhost:5000/health
```

## Frontend Setup

From the repository root:

```bash
cd frontend
npm ci
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Useful Commands

### Backend

Run from the repository root:

```bash
python run.py
flask --app run.py init-db
flask --app run.py drop-db
python setup_oauth.py
```

### Frontend

Run from the repository root:

```bash
cd frontend
npm run dev
npm run lint
npm run build
npm run preview
```

## API Areas

- `/health`
- `/api/inventory`
- `/api/sales`
- `/api/bank-transfers`
- `/api/expenses`
- `/api/subscriptions`
- `/api/email-log`
- `/api/gmail`
- `/api/dashboard`
- `/api/settings`
- `/api/shoes`
- `/api/labels`
