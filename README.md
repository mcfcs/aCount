# aCount

Sneaker resale accounting and financial management system with a Flask API and a React frontend.

## Repository Structure

- `/tmp/workspace/mcfcs/aCount/app` — Flask application, database models, API routes, and Gmail processing logic
- `/tmp/workspace/mcfcs/aCount/frontend` — React + Vite UI
- `/tmp/workspace/mcfcs/aCount/migrations` — Alembic migrations
- `/tmp/workspace/mcfcs/aCount/run.py` — backend entry point and CLI helpers
- `/tmp/workspace/mcfcs/aCount/setup_oauth.py` — one-time Gmail OAuth refresh-token setup script

## Core Capabilities

- Inventory tracking for sneaker pairs
- Sales lifecycle management (pending → confirmed → shipped → completed/cancelled)
- Bank transfer recording and allocation to sales
- Expense and subscription tracking
- Dashboard summaries and financial reporting
- Gmail ingestion + parsing pipeline with processing logs
- Shoe catalog with image support

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

1. Copy `/tmp/workspace/mcfcs/aCount/.env.example` to `/tmp/workspace/mcfcs/aCount/.env`.
2. Fill required values such as:
   - `DATABASE_URL`
   - `SECRET_KEY`
   - Gmail OAuth values if using Gmail ingestion:
     - `GMAIL_CLIENT_ID`
     - `GMAIL_CLIENT_SECRET`
     - `GMAIL_REFRESH_TOKEN`

## Backend Setup

```bash
cd /tmp/workspace/mcfcs/aCount
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

```bash
cd /tmp/workspace/mcfcs/aCount/frontend
npm ci
npm run dev
```

Frontend default URL: `http://localhost:5173`

## Useful Commands

### Backend

```bash
cd /tmp/workspace/mcfcs/aCount
python run.py
flask --app run.py init-db
flask --app run.py drop-db
python setup_oauth.py
```

### Frontend

```bash
cd /tmp/workspace/mcfcs/aCount/frontend
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
