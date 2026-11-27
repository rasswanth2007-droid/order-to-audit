# Order-to-Audit — Full-Stack Operations System for a Small Food Manufacturer

Every transaction is entered once, at its source, and flows automatically into stock, production, costing, accounts, and auditor-ready reports.

- **Sales loop:** mobile order (online or offline queue) → admin verification & stock check → GST tax invoice (PDF + e-Invoice JSON) → FEFO dispatch → finished-goods stock down → receivables, payments & partial returns.
- **Production loop:** supplier purchase → raw/packaging stock → issue per BOM (by batches or raw-material basis) → production run → finished-goods stock up → planned-vs-actual variance & cost per packet.

---

## Run & Deploy

### 1. Single Deployment on Vercel + Supabase (Production)
- **Config:** [vercel.json](vercel.json) builds the React + Vite frontend (`pnpm run build` → `dist/`) and routes `/api/(.*)` and `/health` to the FastAPI serverless entrypoint at [api/index.py](api/index.py).
- **Environment variables on Vercel:**
  - `DATABASE_URL` = Supabase PostgreSQL Session Pooler URI (`postgresql+psycopg2://...sslmode=require`)
  - `ENV` = `production`
  - `SECRET_KEY` = random 32+ character string
- **Database initialization:**
  ```bash
  alembic upgrade head
  python -m app.seed_demo   # or `python -m app.seed` for clean Section-5 master data
  ```

### 2. Local Development
```bash
# Backend (FastAPI on port 8000)
pip install -r requirements.txt
python -m app.seed_demo
uvicorn app.main:app --reload --port 8000

# Frontend (Vite on port 8443, proxied to /api -> 127.0.0.1:8000)
pnpm install
pnpm run dev
```
- **API docs:** `http://localhost:8000/docs`
- **Tests:** `pytest -q` (14 tests covering unit conversions, money/tax math, RBAC/immutability rules, and Section-5 benchmark)
- **Demo logins** (password `Demo@12345`, configurable via `SEED_DEMO_PASSWORD`):
  `admin`, `salesman_a`, `salesman_b`, `production`, `accountant`, `owner` *(quick demo sign-in buttons are available on the login screen)*.

---

## Stack and Why
- **Backend:** Python / FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL (Supabase in production; SQLite for local dev/tests). Business rules, stock ledger, GST math, and costing live in a tested server-side service layer using integer paise and integer base units (`g`, `ml`, `pcs`) — never floating-point arithmetic for money.
- **Frontend:** React 19 + TypeScript + Vite 8 + Tailwind CSS v4 + PWA service worker & IndexedDB offline order queue (`public/sw.js`, `src/utils/offlineQueue.ts`) + English / Tamil (`EN` / `தமிழ்`) UI toggle.

---

## What Is Built Against the Problem Statement Tiers

| Tier | Item | Status |
| --- | --- | --- |
| **Must** | 5 roles with server-side RBAC (`ADMIN`, `SALESMAN`, `PRODUCTION`, `ACCOUNTANT`, `OWNER`) | ✅ |
| **Must** | Product, customer, raw-material, and BOM masters + customer-specific prices | ✅ |
| **Must** | Mobile-friendly order entry + admin edit/approve/reject with stock check | ✅ |
| **Must** | GST tax invoice PDF (GSTIN, HSN, CGST/SGST or IGST by place of supply, FY numbering, amount in words) | ✅ |
| **Must** | Production run updating raw/packaging stock down & finished goods up automatically | ✅ |
| **Must** | Planned vs actual consumption & yield with tolerance flags | ✅ |
| **Must** | Stock summary & append-only stock ledger; sales register & stock reports as CSV/XLSX/PDF | ✅ |
| **Should** | Purchases & suppliers, payments with FIFO/invoice allocation, outstanding & ageing, cost/packet with overheads, GSTR-1/3B summary, variance alerts, owner dashboard | ✅ |
| **Stretch** | Offline-safe salesman order queue + IndexedDB cache + `POST /api/v1/orders/sync` | ✅ |
| **Stretch** | Batch & expiry tracking + FEFO dispatch + partial dispatch | ✅ |
| **Stretch** | Reorder levels, low-stock alerts, and pending-order aggregate production planning | ✅ |
| **Stretch** | Salesman GPS check-in & visit log (`POST/GET /api/v1/visits`) | ✅ |
| **Stretch** | Tally-compatible XML voucher export (`GET /api/v1/reports/tally-xml`) | ✅ |
| **Stretch** | NIC GST e-Invoice v1.03 & e-Way Bill JSON export (`GET /api/v1/invoices/{id}/einvoice`) | ✅ |
| **Stretch** | Tamil (`தமிழ்`) language interface toggle across navigation & content | ✅ |
| **Extras** | Partial sales returns & full invoice cancellation via credit notes, promotional schemes, WIP view, audit log inspector, ledger reconciliation endpoint | ✅ |

---

## Benchmark (Section 5) — Verified by `tests/test_benchmark.py`

| Check | Expected | This System |
| --- | --- | --- |
| Flour / Oil / Pouches closing | 120 kg / 19.5 L / 306 | 120 kg / 19.5 L / 306 ✅ |
| Finished goods after run / after Retailer A dispatch | 238 / 88 | 238 / 88 ✅ |
| Yield variance | −6%, flagged | −6.00%, flagged ✅ |
| Oil variance | +5%, flagged | +5.00%, flagged ✅ |
| Retailer A invoice | ₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875 | Identical ✅ |
| Retailer A outstanding | ₹3,875 | ₹3,875 ✅ |
| Distributor B | Shortage 32; IGST if invoiced | Shortage 32; approval blocked (`409`) unless back-order accepted; IGST 5% = ₹300 on ₹6,000 ✅ |
| Cost per packet | Own figure | **₹31.14**, margin ₹18.86 (37.7%) |

Cost per packet: materials ₹4,055.00 (flour 40 kg at weighted-average ₹43.125 = ₹1,725; oil ₹1,470; spice ₹240; pouches 194 × ₹2.50 = ₹485 incl. 6 damaged; cartons 9 × ₹15 = ₹135) + labour ₹1,200 + gas/power ₹600 = ₹5,855 ÷ 188 good packets.

---

## Assumptions
- GST 5% on murukku (per benchmark); factory GSTIN in Tamil Nadu (`33`); intra-state iff buyer state = `33`.
- Financial year Apr–Mar; invoice/credit-note numbering per FY; ageing counted from invoice date.
- Invoices with allocated payments cannot be cancelled until payments are adjusted.

## Security & Integrity
- `bcrypt(12)` password hashing + strength rules; JWT with per-user `token_version` revocation; login lockout & rate limiting; strict Pydantic schemas (`extra="forbid"`); server-side RBAC on every endpoint; salesman IDOR protection (`404`); server-authoritative pricing; parameterised SQLAlchemy ORM; append-only `stock_ledger` and `audit_log`; CSV formula-injection neutralisation; idempotent `client_ref` keys.

## Repo Map
- `api/index.py` & `vercel.json` — Vercel serverless entrypoint & routing
- `app/` — FastAPI backend (`models.py`, `schemas.py`, `routers/`, `services/`)
- `src/` — React + TypeScript frontend (`components/`, `context/`, `services/`, `utils/`)
- `public/` — PWA manifest, icons, and offline service worker (`sw.js`)
- `alembic/` — PostgreSQL / SQLite schema migrations
- `tests/` — Pytest suite (`test_benchmark.py`, `test_rules.py`, `test_units_money.py`)
- `docs/` — [DESIGN.md](docs/DESIGN.md) & [API_ENDPOINTS.md](docs/API_ENDPOINTS.md)
