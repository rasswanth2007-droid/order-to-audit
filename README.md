# Order-to-Audit — backend for a small food manufacturer

Every transaction is entered once, at its source, and flows into stock, production, costing, receivables and the auditor's reports.
**Sales loop:** order → verification → GST invoice → dispatch → finished goods down → receivables.
**Production loop:** purchase → raw stock → issue per BOM → production run → finished goods up → variance & cost per packet.

This repository is the API (FastAPI + SQLAlchemy). The UI is specified in `docs/FIGMA_PROMPT.md`.

## Run it

```bash
# Option 1: Docker (Postgres)       Option 2: local (SQLite, zero setup)
docker compose up --build           pip install -r requirements.txt
                                    python -m app.seed        # loads section-5 master data
                                    uvicorn app.main:app --reload
```

API docs: http://localhost:8000/docs · Tests: `pytest -q` · Reset demo data: `python -m app.seed --reset`

Demo logins (password `Demo@12345`, set via `SEED_DEMO_PASSWORD`; **demo only**): `admin`, `salesman_a`, `salesman_b`, `production`, `accountant`, `owner`.
Production mode (`ENV=production`) refuses to start with the default `SECRET_KEY` and refuses to seed with the default password; use `alembic upgrade head` for the schema.

## Stack and why

Python/FastAPI + SQLAlchemy 2 + Postgres (SQLite for local/tests). The hard part of this problem is correctness of stock, tax and cost arithmetic, so the business rules live in a small, testable service layer on the server with a real relational schema, constraints and migrations. Money is integer paise, quantities are integers in a base unit (g, ml, pcs) — no floats in any calculation.

## What is built against the tiers

| Tier      | Item                                                                                                                                                          | Status                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Must      | 5 roles with server-side RBAC (salesman, admin, production, accountant, owner)                                                                                | ✅                                      |
| Must      | Product / customer / raw-material / BOM masters, price list, customer-specific prices                                                                         | ✅                                      |
| Must      | Mobile order API + admin edit/approve/reject with stock check                                                                                                 | ✅                                      |
| Must      | GST tax invoice PDF (GSTIN, HSN, CGST/SGST or IGST by place of supply, FY numbering, amount in words)                                                         | ✅                                      |
| Must      | Production run → raw/packaging down, finished goods up, automatically                                                                                         | ✅                                      |
| Must      | Planned vs actual consumption & yield with tolerance flags                                                                                                    | ✅                                      |
| Must      | Stock summary + stock ledger; sales register + stock report as CSV/XLSX/PDF                                                                                   | ✅                                      |
| Should    | Purchases & suppliers, payments with allocation, outstanding & ageing, cost/packet with overheads, GSTR-1/3B-shaped summary, variance alerts, owner dashboard | ✅                                      |
| Stretch   | Offline-safe order sync (idempotent `client_ref`, `/orders/sync`)                                                                                             | ✅ API (client queue is in the UI spec) |
| Stretch   | Batch & expiry, FEFO dispatch; reorder levels / low-stock; production suggestion from shortage ("make 1 batch")                                               | ✅                                      |
| Extras    | Partial dispatch, credit notes with stock return, audit log API, reconciliation endpoint                                                                      | ✅                                      |
| Not built | Tally XML export, e-invoice/e-way bill JSON, GPS visit log, Tamil UI, returns other than full cancellation                                                    | ❌                                      |

## Benchmark (section 5) — executed by `tests/test_benchmark.py`

| Check                                       | Expected                        | This system                                                                                      |
| ------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Flour / Oil / Pouches closing               | 120 kg / 19.5 L / 306           | 120 kg / 19.5 L / 306 ✅                                                                         |
| Finished goods after run / after A dispatch | 238 / 88                        | 238 / 88 ✅                                                                                      |
| Yield variance                              | −6%, flagged                    | −6.00%, flagged ✅                                                                               |
| Oil variance                                | +5%, flagged                    | +5.00%, flagged ✅                                                                               |
| Retailer A invoice                          | 7,500 + 187.50 + 187.50 = 7,875 | identical ✅                                                                                     |
| Retailer A outstanding                      | 3,875                           | 3,875 ✅                                                                                         |
| Distributor B                               | shortage 32; IGST if invoiced   | shortage 32; approval blocked (409) unless admin accepts back-order; IGST 5% = ₹300 on ₹6,000 ✅ |
| Cost per packet                             | own figure                      | **₹31.14**, margin ₹18.86 (37.7%)                                                                |

Cost per packet: materials ₹4,055.00 (flour 40 kg at weighted-average ₹43.125 = 1,725; oil 1,470; spice 240; pouches 194 × 2.50 = 485 incl. 6 damaged; cartons 9 × 15 = 135) + labour 1,200 + gas/power 600 = ₹5,855 ÷ 188 good packets.

Differences / judgement calls worth knowing:

- **Pouches** vary −3.00% (194 used incl. damaged vs 200 planned) — exactly at tolerance, so _not_ flagged ("beyond 3%"). **Cartons** 9 vs 10 is −10% and is flagged as FAVOURABLE (flagging is two-sided; direction is shown).
- **Valuation = moving weighted average.** Chosen because purchases arrive in mixed lots and a bakery-style floor cannot track layers by hand. With FIFO the flour would cost ₹42 (opening layer) and cost/packet would be ₹30.90.
- **Overhead rule:** per-run overheads (labour, gas/power) go straight to the run; a monthly pool (rent, supervisor…) is allocated to runs by share of good packets. Overheads entered _after_ the run add a value-only ledger entry to finished goods.
- **Opening finished goods** has no value in the PS; I assumed ₹30/packet (lot `OPENING`, no expiry, dispatched first by FEFO).
- **Dispatch COGS** uses the weighted-average at the time of dispatch (before step-8 overheads); the authoritative cost per packet is the run costing above.
- Invoice totals are rounded to the nearest rupee with a visible round-off line (₹0 in the benchmark).

## Assumptions

GST 5% on murukku (per the PS); one factory GSTIN in Tamil Nadu (33); intra-state iff buyer state = 33; one invoice per order; a customer belongs to at most one salesman (unassigned customers are visible to all); shelf life 90 days; financial year Apr–Mar; ageing counted from invoice date; invoices with payments allocated cannot be cancelled until payments are adjusted (no refund module).

## Known gaps / honest limits

- Verified by tests here: SQLite only. The Postgres path (docker-compose, `FOR UPDATE` row locks, migration) is written but **not executed in my environment**.
- Login throttling and the global rate limiter are in-memory (single process); use Redis/gateway when scaling out.
- No load/performance test, no automated browser/E2E tests (no UI in this repo), no tested backup restore (a `scripts/backup.sh` is provided), no external security scan. This is not a claim of being bug-free or fully secure.
- Concurrent dispatch safety relies on write-locking (SQLite `BEGIN IMMEDIATE`) / row locks (Postgres); no concurrency stress test yet.
- Stock balances are computed by SUM over the ledger (fine at factory scale); add a periodic snapshot if the ledger reaches millions of rows.
- GST report is shaped like GSTR-1/3B tables, not a portal-valid JSON; verify before filing.

## Security & integrity design (what exists, where)

Password hashing bcrypt(12) + strength rules; JWT with per-user `token_version` (password change/role change revokes sessions); login lockout; per-IP rate limit; strict pydantic models (`extra=forbid`); every endpoint role-checked server-side; salesman ownership checks return 404 (no IDOR); prices decided on the server; parameterised ORM only; CORS allow-list; security headers; no secrets in code (`.env`); CSV formula-injection neutralised; uniform error envelope without stack traces; append-only `stock_ledger` and `audit_log` (ORM guard) ; CHECK/UNIQUE/FK constraints; one DB transaction per request; idempotency keys for orders, payments and purchases.

## Repo map

`app/models.py` schema · `app/services/` business rules (inventory, production, sales, gst, payments, costing, reports, exporters, invoice_pdf) · `app/routers/` HTTP · `tests/` · `alembic/` migrations · `docs/DESIGN.md` design note · `docs/FIGMA_PROMPT.md` UI spec · `docs/API_ENDPOINTS.md`.
