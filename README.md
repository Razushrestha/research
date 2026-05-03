# Research Paper Backend

Node.js + Express backend for research paper uploads, researcher metadata, and Khalti-style payment handling.

## Features

- `POST /research/upload` for paper upload + researcher info
- `GET /research` list papers with filtering/pagination
- `GET /research/:id` paper detail with researchers
- `GET /research/my/:email` papers uploaded by a user
- `POST /payment/initiate/:paperId` create a payment record
- `GET /payment/verify?pidx=...` verify payment status
- `POST /payment/mock-success/:paperId` simulate paid success (test flow)
- `GET /payment/wallet/:email` fetch wallet balance + transactions
- `POST /research/:id/download` record download access for continue reading
- `GET /research/continue-reading/:email` list downloaded/purchased papers
- `PATCH /research/continue-reading/:paperId/progress` update reader progress
- `GET /health` database connectivity check (for load balancers / monitoring)
- Security: Helmet HTTP headers, configurable CORS, rate limiting

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and update values.

3. Create database and run `db/init.sql`.

4. Start backend:

```bash
npm run dev
```

## Docker

PostgreSQL and the API together:

```bash
docker compose up --build
```

API: `http://localhost:4000` - Postgres: `localhost:5432` (user/password/db: `research` / `research` / `research_papers_db` per `docker-compose.yml`).

## Linux VPS deployment

Use `docker-compose.vps.yml` with `.env.vps` for production-like VPS setup (persistent DB/uploads, restart policy, API healthcheck, startup migration). Recommended production flow is Nginx + HTTPS in front of the API:

```bash
cp .env.vps.example .env.vps
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
```

Detailed steps are in `DEPLOY_VPS.md`.

## Tests

```bash
npm test
```

Uses mocked database calls for HTTP smoke tests (`tests/app.test.js`).

## File uploads

Uploaded files are saved under `/uploads` in development (or `UPLOAD_DIR`).

## Notes

- This scaffold uses PostgreSQL via `DATABASE_URL`.
- Payment verification uses Khalti when `KHALTI_SECRET_KEY` is configured.
- `POST /payment/initiate/:paperId` requires `buyer_email` in the body and returns a `payment_url`.
- `GET /payment/verify?pidx=...&token=...` confirms Khalti payment when configured.
- On successful paid verification, wallet settlement is split as 40% to paper uploader (`research_papers.email`) and 60% to `PLATFORM_ADMIN_EMAIL`.
