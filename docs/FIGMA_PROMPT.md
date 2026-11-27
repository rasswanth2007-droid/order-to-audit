# FIGMA / FIGMA MAKE PROMPT — "Order-to-Audit" frontend

> Paste everything below the line into Figma Make (or Figma AI). It is the single source of truth. Build exactly what is written. Do not add, rename, remove or reorder screens, fields, buttons or rules. Where something is not specified, choose the simplest option and leave a visible `TODO` comment instead of inventing features.

---

## 0. WHAT YOU ARE BUILDING

A web app (React + TypeScript + Tailwind, responsive, installable as a PWA) for a small South Indian snack factory. One app, five roles, role-based navigation. It talks to an existing REST API (base URL from env `VITE_API_BASE`, all paths below are under `/api/v1`). The UI contains **no business logic**: it never calculates tax, stock, price, variance or cost — it only displays what the server returns and sends user input. (Allowed client-side: formatting, input validation hints, and showing a running _estimate_ of an order total labelled "Estimate — server decides final price".)

Roles and home screens: SALESMAN (mobile, 360–430px wide) → "New Order"; ADMIN (desktop) → "Orders inbox"; PRODUCTION (desktop/tablet) → "Production runs"; ACCOUNTANT (desktop, read-only) → "Reports"; OWNER (any device) → "Dashboard".

## 1. GLOBAL RULES (apply to every screen)

1. **Language & tone**: English UI, plain words, no jargon. Currency `₹` with Indian digit grouping (`₹12,34,567.89`). Dates `DD-MMM-YYYY` (e.g. `27-Nov-2026`). Quantities exactly as the API gives (`qty` string + `unit`), e.g. `40 kg`, `19.5 l`, `188 packet`.
2. **Money**: the API uses integer **paise** in fields ending `_paise`. Convert to rupees for display by string/integer maths only (never floating point). Inputs accept rupees with max 2 decimals and convert to paise before sending. Percent fields ending `_pct` are already strings like `"-6.00"`; display with `%`.
3. **Every screen has four states designed**: loading (skeleton, not spinner-only), empty (icon + one sentence + the primary action), error (message from `error.message`, a Retry button, and the `X-Request-ID` shown small as "Ref"), success (toast, auto-dismiss 4 s, `aria-live=polite`).
4. **Error envelope**: every error is `{"error":{"code","message","details"}}`. Show `message` to the user. Special codes: `unauthorized` (401) → clear session, go to Login with banner "Session expired, please sign in again" and return to the same page after login; `forbidden` (403) → "You don't have access to this"; `validation_error` (422) → put `details.fields[].msg` next to the matching input (`loc`); `insufficient_stock` (409) → show the shortage UI described per screen; `conflict` (409) → show message; `too_many_attempts` / `rate_limited` (429) → show message, disable the submit button for 30 s.
5. **Double-submit protection**: every submit button becomes disabled with an inline spinner while its request is in flight; re-enabled on completion. Money/stock actions (Approve, Create invoice, Dispatch, Cancel invoice, Record payment, Complete run, Save purchase) ask for a one-line confirmation dialog stating the consequence, e.g. "Dispatch will reduce stock. Continue?".
6. **Idempotency**: when creating an Order, Payment or Purchase generate a UUID v4 once per _form instance_ and send it as `client_ref`; reuse the same value on retry. A "duplicate": true response must be shown as success ("Already received").
7. **Auth/session**: login at `POST /auth/login`; keep the access token **in memory only** (React state) — never `localStorage`, never URL, never logged. Send `Authorization: Bearer <token>`. Show the signed-in name + role in the header, a "Sign out" button, and a "Change password" page (`POST /auth/change-password`, rules: ≥10 chars, upper, lower, digit; after success use the new token returned). Auto sign-out when any call returns 401. No auto-fill of passwords by the app; password field has show/hide toggle.
8. **Role guard**: show only the menu items listed for that role (section 3–7). Do not render screens for other roles, but also assume the server enforces everything (a 403 must be handled gracefully).
9. **No secrets** in code, comments, screenshots or sample data. Use `.env` style config for the API base only. No analytics, no third-party scripts, system font stack as fallback.
10. **Tables**: sticky header, right-aligned numbers, tabular numerals, row hover, keyboard-focusable rows that open details, pagination controls using `limit`/`offset` (default 50) with "Showing X–Y of total". On phones tables become stacked cards.
11. **Forms**: visible `<label>` for every input, helper text, inline validation on blur, required marker, error text linked with `aria-describedby`, correct `inputmode` (`decimal` for quantity/money, `numeric` for counts), Enter submits only the primary action, first invalid field focused on submit.
12. **Destructive/irreversible actions** use a red button and a dialog; never delete. There is no "delete" anywhere in this product (invoices are cancelled with a credit note).

## 2. DESIGN SYSTEM (use these tokens; do not improvise)

- Style: clean, calm, utilitarian — warm off-white background, deep teal primary, saffron accent used only for warnings/flags. Generous touch targets.
- Colours (all text/background pairs must meet WCAG 2.1 AA 4.5:1; large text 3:1): background `#FAF8F5`, surface `#FFFFFF`, text `#1B1B1B`, muted text `#5B5B5B`, border `#DDD8D0`, primary `#0F5C5C` (white text), primary hover `#0B4747`, success `#1E7B3A`, warning `#B35C00` (badge bg `#FFF1DC`), danger `#B3261E` (badge bg `#FDE7E5`), info `#1F4E8C`.
- Type: Inter (fallback system-ui). Sizes: 12 caption, 14 body, 16 inputs (≥16 px on mobile to avoid zoom), 20 section title, 28 page title. Numbers use tabular figures.
- Spacing 4-pt scale; radius 8 (cards) / 6 (inputs); focus ring 2 px primary + 2 px white offset on every interactive element (never remove outlines).
- Components to define once and reuse: Button (primary/secondary/danger/ghost, sizes M/L), Input, Select (searchable for customers/products), Quantity+Unit input, Money input, Badge, Toast, Dialog (focus-trapped, Esc closes unless confirm-critical), Table, Card, Stat tile, Empty state, Skeleton, Banner (offline / session / error), Tabs, Stepper, Date-range picker.
- Status badges (colour **and** text/icon, never colour alone): Order `SUBMITTED` info, `APPROVED` primary, `INVOICED` primary, `DISPATCHED` success, `REJECTED` danger, `CANCELLED` muted. Invoice `ISSUED` success, `CANCELLED` danger; dispatch `NONE/PARTIAL/FULL`. Run `PLANNED/ISSUED/COMPLETED`. Variance flag: warning badge `FLAG ▲ ADVERSE` or `FLAG ▼ FAVOURABLE` with the percentage.
- Responsive: mobile-first. Salesman screens designed at 390×844 and must work 360–430 wide with a bottom tab bar. Admin/Production/Accountant screens designed at 1440×900 with a left sidebar, collapsing to a top drawer under 1024. Production screens must also work on a 10-inch tablet (≥ 48 px touch targets). Support light mode only. Respect `prefers-reduced-motion`.

## 3. SALESMAN (mobile) — nav: bottom tabs "New order", "My orders", "My sales"; header with name, online/offline pill, sign out.

**S1 Login** (all roles share it): fields Username, Password; button "Sign in"; shows lockout message on 429; link none. After login route by role.

**S2 New order** (`GET /customers`, `GET /items`, `GET /availability`, `POST /orders`)

1. Step 1 "Customer": searchable list (`GET /customers?q=`), each row shows name, type (Retailer/Distributor), state code. Select one.
2. Step 2 "Products": list of finished products from `/items` (name, price from `selling_price_paise`, available packets from `/availability`). Each row has a stepper (− / number / +) and unit toggle `packet | carton` (carton = `packets_per_carton` packets; send `unit` as chosen). Quantity must be a positive whole number of packets. If entered quantity > available show non-blocking warning "Only N packets free right now — the factory will confirm." (the order can still be submitted). Show sticky footer: item count and _estimated_ total labelled "Estimate".
3. Step 3 "Review": customer, lines (name, qty, price, line amount estimate), optional Notes (≤255 chars), button "Submit order". Target: whole flow achievable in under 60 seconds with ≤ 8 taps for a repeat customer.
4. Submit sends `{customer_id, client_ref, lines:[{item_id, qty, unit}], notes, taken_at: <ISO time on device>}`. Never send a price. On 201/200 show a success screen with `order_no`, status and buttons "New order" / "View order". On 403 (customer assigned to another salesman) show the message.
5. **Offline**: see section 8. If offline, "Submit" saves to the device queue and shows "Saved on this phone — will send automatically".

**S3 My orders** (`GET /orders?status=&limit=&offset=`): filter chips All/Submitted/Approved/Invoiced/Dispatched/Rejected; card per order: order_no, customer, date, total (`total_paise`), status badge, and when `invoice` exists "Invoice <invoice_no> · Dispatch: None/Partial/Full". Pull-to-refresh. Queued (not yet sent) orders appear at the top with badge "Waiting to send" and a "Send now" button.
**S4 Order detail** (`GET /orders/{id}`): lines with qty and price, total, status timeline (Submitted → Approved → Invoiced → Dispatched; Rejected shows `rejection_reason`). Button "Cancel order" (`POST /orders/{id}/cancel`) only while SUBMITTED, with confirm. If invoiced: button "Share invoice" (`GET /invoices/{id}/share` → open `whatsapp_url`) and "View PDF" (`GET /invoices/{id}/pdf` fetched with the auth header, opened as a blob URL).
**S5 My sales** (`GET /me/sales`): total value tile, list of customers with order count and value, counts by status, optional date range.

## 4. ADMIN (desktop) — sidebar: Orders, Invoices, Payments & Receivables, Customers, Products, Suppliers, Purchases, Bill of Materials, Stock, Production (read), Reports, Audit log, Users, Settings.

**A1 Orders inbox** (`GET /orders`): tabs Submitted (default) / Approved / Invoiced / Dispatched / Rejected / All; table: order_no, customer, salesman, date, total, status, stock indicator. Click opens A2.
**A2 Order review** (`GET /orders/{id}`, `GET /orders/{id}/stock-check`): left = order lines table with **editable** quantity and price (price shown per packet with original shown struck-through when changed; quantity unit packets); right = Stock panel: per line `required`, `on_hand`, `committed_to_others`, `available`, `shortage` (red when > 0) and `suggested_batches_to_produce` ("Produce N batch(es)"). Buttons: "Save changes" (`PUT /orders/{id}` with `{lines:[{item_id, qty, unit:"packet", price_paise}]}`; only SUBMITTED), "Approve" (`POST /orders/{id}/approve` body `{accept_shortage:false, raise_invoice:false}`), "Approve & create invoice" (`raise_invoice:true`), "Reject" (dialog with required reason ≥3 chars → `POST /orders/{id}/reject`).

- **Shortage handling** (HTTP 409 `insufficient_stock`, details = stock check): show a dialog titled "Stock does not cover this order" listing each short line (e.g. "Murukku 200 g — need 120, free 88, short 32"). Three actions: (1) "Reduce quantity to available" (fills editable quantities with `available`, user then saves and approves), (2) "Approve as back-order" (re-sends with `accept_shortage:true`; confirm text "Invoice will be raised for the full quantity; you can dispatch only what is in stock"), (3) "Reject". Never silently approve.
- After approval (status APPROVED) show "Create GST invoice" (`POST /orders/{id}/invoice`).
  **A3 Invoices** (`GET /invoices`): filters status, customer, date range; columns invoice_no, date, customer, taxable, GST total (cgst+sgst+igst), total, outstanding, dispatch status, status. Row → A4.
  **A4 Invoice detail** (`GET /invoices/{id}`): header (invoice_no, date, buyer name/GSTIN, place of supply, supply type "Intra-state CGST+SGST" or "Inter-state IGST"), lines (description, HSN, qty, rate, taxable, GST rate `gst_rate_bp/100`%, tax amounts, dispatched_qty), tax summary (taxable, CGST, SGST, IGST, round off, total), dispatches list with batch numbers and expiry, credit note block if cancelled. Buttons: "Download PDF" (`/invoices/{id}/pdf`), "Share on WhatsApp" / "Share by email" (`/invoices/{id}/share`), "Record dispatch", "Record payment", "Cancel invoice".
- **Dispatch dialog** (`POST /invoices/{id}/dispatch` `{lines?:[{invoice_line_id, qty}], vehicle_no, notes}`): defaults to all remaining quantities, each editable (≤ remaining); on 409 `insufficient_stock` show per-line shortage from `details.lines` and offer "Dispatch what's available" (pre-fills qty with `on_hand`). Success shows `dispatch_no` and the batches taken.
- **Cancel invoice dialog**: warns "This creates a credit note, returns dispatched goods to stock and cannot be undone"; required reason (≥3 chars); on 409 (payments allocated) show the message.
  **A5 Payments & Receivables**: tab "Record payment" form (customer select → shows `GET /customers/{id}/account` billed / received / outstanding and open invoices; Amount (₹), Mode CASH/UPI/BANK/CHEQUE, Reference, optional "Apply to invoice" select; `POST /payments`; after save show allocation list and any `unallocated_paise` as "Advance"); tab "Payments" (`GET /payments`); tab "Outstanding & ageing" (`GET /reports/outstanding`) with buckets 0-30, 31-60, 61-90, 90+ and an Export menu.
  **A6 Customers** (`GET/POST /customers`, `PUT /customers/{id}`, `GET/PUT /customers/{id}/prices`): table + drawer form: Name, Type, GSTIN (validate pattern client-side as hint), State code (2 digits), Address, Phone, Credit days, Assigned salesman (from `GET /users`, role SALESMAN), Active. Tab "Special prices": item + price per packet.
  **A7 Products & materials** (`GET/POST /items`, `PATCH /items/{id}`): tabs Finished / Raw / Packaging. Form: SKU, Name, Kind, Display unit (kg, g, l, ml, pcs; finished = packet), HSN, GST rate (bp shown as %), Selling price (finished only), Packets per carton, Shelf life days, Reorder level, Active. Unit conversion help text under quantity inputs: "1 kg = 1000 g · 1 l = 1000 ml · 1 carton = N packets".
  **A8 Suppliers** (`GET/POST /suppliers`). **A9 Purchases** (`GET/POST /purchases`): form with Supplier, Supplier bill no, Date, lines (item, qty + unit, rate per that unit in ₹, GST %); list shows `purchase_no`, taxable, tax, total.
  **A10 Bill of Materials** (`GET /boms`, `GET/PUT /boms/{product_id}`): per finished product: "Expected packets per batch" and lines (item, qty, unit); saving bumps `version`; show warning "Changing a BOM does not change past production runs".
  **A11 Stock** (see section 6 shared screens). **A12 Reports** (shared, section 7). **A13 Audit log** (`GET /audit`): filters entity, entity_id, username; columns time, user, action, entity, id; row expands to show Before/After JSON in a readable key-value view. **A14 Users** (`GET/POST /users`, `PATCH /users/{id}`): create (username, full name, role, password with strength rules), edit name/role/active, "Reset password"; cannot deactivate yourself. **A15 Settings** (`GET/PUT /settings`): variance tolerance % (0–100), company profile fields (name, GSTIN, state code, state name, address, phone, email, invoice prefix, bank line).

## 5. PRODUCTION (desktop/tablet) — nav: Production runs, Stock, Purchases, Materials (read + create raw/packaging), Reports (stock & production only).

**P1 Production runs** (`GET /production/runs`): table run_no, product, status, planned vs good output, date, flag count badge. Button "New run".
**P2 New run** (`POST /production/runs`): Product (finished with BOM), then choose **one** of: "Number of batches" (default 1) **or** "Raw material to be used" (item from the BOM + quantity + unit; server derives batches). After creating, show read-only "Expected output" (`planned_output`) and the planned material quantities (`plan` from `GET /production/runs/{id}`). Planned date, Notes.
**P3 Run detail** (`GET /production/runs/{id}`) is a 3-step stepper:

1.  **Issue materials** (`POST /production/runs/{id}/issue` `{lines:[{item_id, qty, unit}]}`): table pre-listing planned quantities as placeholders; user enters actual issued qty per material with unit. On 409 `insufficient_stock` show "Only X available" for the item.
2.  **Record output** (`POST /production/runs/{id}/complete` `{good_output, rejected_output, packaging_used:[…], wastage:[{item_id, qty, unit, reason}], mfg_date}`): fields Good packets, Rejected packets, Packaging used (e.g. pouches, cartons: item + qty + unit), Wastage (item, qty, unit, reason; e.g. damaged pouches). Confirm dialog: "This updates raw-material and finished-goods stock."
3.  **Costs** (`POST /production/runs/{id}/overheads` `{category: LABOUR|GAS_POWER|OTHER, amount_paise, note}`): can be added any time, including after completion.
    Right panel always visible: **Planned vs actual** table (`variance.lines`: material, planned, actual, difference, variance %, flag badge with direction) and a Yield card (`variance.yield`: planned, actual, rejected, variance %, flag). Header note "Flagged when beyond ±{tolerance_pct}%". Below: **Cost** card (`cost`: materials, overheads, total, good output, **cost per packet**, selling price, margin ₹ and %). Show batch number and expiry date once completed.
    **P4 Adjustments** (`POST /inventory/adjustments` `{item_id, qty (negative = loss), unit, reason ≥3 chars, batch_no?, value_paise (required when adding stock)}`) with confirm dialog; wording "Use only for counting differences, spoilage or corrections".

## 6. SHARED STOCK SCREENS (Admin, Production, Owner, Accountant read-only)

- **Stock summary** (`GET /inventory/summary?kind=`): tabs Raw / Packaging / Finished; columns item, quantity + unit, value, avg cost per unit, reorder level, **Low stock** badge when `low_stock`.
- **Stock ledger** (`GET /inventory/ledger`): filters item, date range, source type; columns date, item, movement type (human labels: Opening, Purchase, Issued to production, Production wastage, Production output, Sold/dispatched, Sales return, Adjustment, Cost adjustment), signed quantity, value, batch, source document link (purchase / production run / dispatch / credit note) .
- **Finished-goods lots** (`GET /inventory/lots`): product, batch, expiry, packets; order = first-expiry-first-out; badge "Expires in N days" when ≤ 30.
- **Integrity check** (`GET /inventory/reconcile`) for Admin/Accountant/Owner: list of checks with ✔/✖.

## 7. ACCOUNTANT / AUDITOR (read-only) and Reports

Nav: Reports, Stock, Invoices, Payments, Audit log, Dashboard. **No create/edit/cancel buttons are rendered for this role.**
**Reports** (`GET /reports` for the list; `GET /reports/{key}?from_date&to_date&format=json|csv|xlsx|pdf`): a catalogue page with one card per report: Sales register, Customer-wise sales, Product-wise sales, GST summary (GSTR-1 / 3B), Purchase register, Stock summary, Stock ledger, Production report (planned vs actual), Collections, Outstanding with ageing, Cost per packet, Finished goods by batch. Each opens a report page: date-range picker with presets (This month, Last month, This FY, Custom; stock/outstanding use "As on"), a rendered preview from the JSON (`sections[]` → each with title, `columns[{key,label,kind}]`, `rows`, optional `totals`; render `kind`: money = paise→₹, date, int, text), notes from `notes[]`, and an **Export** menu (CSV, Excel, PDF) that downloads the file using the auth header (fetch → blob → save). Preview sections for GST summary appear as separate tabs.
**Dashboard** (Owner home; also Admin/Accountant) (`GET /dashboard`): tiles: Orders today (count, value), Pending approvals (click → Orders inbox), Outstanding (total and overdue), Cost per packet (per product with margin %); lists: Variance alerts (run, what, variance %, direction; click → run), Low-stock materials, Stock levels (raw, packaging, finished), Top debtors. Auto-refresh every 60 s and a manual Refresh.

## 8. OFFLINE ORDER CAPTURE (salesman only)

- Register a service worker; cache the app shell, the customer list, the product list and last availability so the New-order flow works with no network. Show a persistent pill "Online" / "Offline" and a banner when offline.
- If a submit fails with a network error (or the device is offline) store `{client_ref, customer_id, lines, notes, taken_at}` in IndexedDB (never store the token or passwords). Show it in My orders as "Waiting to send".
- When connectivity returns or the user taps "Send now", upload the queue with `POST /orders/sync {orders:[…]}`; mark each `results[i].ok` as sent (show `order_no`), keep failed ones with their `error` and an "Edit / Remove from queue" action. `duplicate:true` counts as sent. If the server answers 401, ask the user to sign in again, then continue syncing. Retry with exponential backoff (5 s, 15 s, 45 s, max 5 min).
- Queue is cleared of sent items only after a confirmed success.

## 9. ACCESSIBILITY (WCAG 2.1 AA) — acceptance rules

Semantic landmarks (`header`, `nav`, `main`), one `h1` per page, skip-to-content link, full keyboard operation with logical tab order, visible focus, dialogs trap focus and return focus on close, tables use `<th scope>`, icons have text alternatives, errors announced via `aria-live`, no information by colour alone, min touch target 44×44 px (48 on production tablet), text resizable to 200 % without loss, no auto-playing motion.

## 10. SECURITY & QUALITY RULES FOR THE FRONTEND (from the engineering checklist)

Escape all rendered strings (never `dangerouslySetInnerHTML`); validate inputs client-side only as UX, the server is authoritative; never compute prices/tax/stock on the client; token only in memory; no sensitive data in URLs, console logs or error toasts; open PDFs/exports as blobs; Content-Security-Policy-friendly (no inline scripts, no eval); handle network timeouts (15 s) with a retry button; GET requests may retry with backoff, **POST requests never auto-retry except with the same `client_ref`**; prevent duplicate submissions; handle expired sessions; keep the UI responsive with pagination (never load unbounded lists); provide loading, empty and error states everywhere; keep components small and typed; centralise API calls and error handling in one `api` module that adds the auth header, parses the error envelope and exposes `requestId`.

## 11. DEMO FLOW THESE SCREENS MUST SUPPORT END TO END (benchmark)

Purchase 60 kg flour @ ₹45 → new run of Murukku 200 g (1 batch) → issue 40 kg flour, 10.5 l oil, 1.2 kg spice → output 188 good, pouches used 188 + wastage 6 damaged, cartons used 9 → Salesman A (mobile) orders 150 for Retailer A → Admin approves, creates invoice (CGST+SGST), dispatches → Salesman B orders 120 for Distributor B and the shortage dialog appears (32 short) → record ₹4,000 payment from Retailer A (outstanding shows ₹3,875) → add labour ₹1,200 and gas/power ₹600 → run page shows cost per packet → open Reports and export each one. The run page must show the yield −6.00 % flag and the oil +5.00 % flag.

## 12. DELIVERABLE FROM FIGMA

Frames for every screen in sections 3–7 (mobile 390 and desktop 1440), a component library page with all tokens/components/states, a clickable prototype of the benchmark flow in section 11, and a short "states" page showing loading/empty/error for the order list, order review and run detail.

# API endpoints (generated from OpenAPI)

Base URL: /api/v1 (prefix already included in the paths below). Live docs at /docs in development.

- GET /api/v1/audit — Audit Log
- POST /api/v1/auth/change-password — Change Password
- POST /api/v1/auth/login — Login
- GET /api/v1/auth/me — Me
- GET /api/v1/availability — Fg Availability
- GET /api/v1/boms — List Boms
- GET /api/v1/boms/{product_id} — Get Bom
- PUT /api/v1/boms/{product_id} — Put Bom
- GET /api/v1/costing — Costing View
- POST /api/v1/costing/monthly-overheads — Monthly Overhead
- GET /api/v1/customers — List Customers
- POST /api/v1/customers — Create Customer
- PUT /api/v1/customers/{cid} — Update Customer
- GET /api/v1/customers/{cid}/account — Customer Account
- GET /api/v1/customers/{cid}/prices — Customer Prices
- PUT /api/v1/customers/{cid}/prices — Set Customer Price
- GET /api/v1/dashboard — Dashboard
- POST /api/v1/inventory/adjustments — Adjustment
- GET /api/v1/inventory/ledger — Inv Ledger
- GET /api/v1/inventory/lots — Fg Lots
- GET /api/v1/inventory/reconcile — Reconcile
- GET /api/v1/inventory/summary — Inv Summary
- GET /api/v1/invoices — List Invoices
- GET /api/v1/invoices/{invoice_id} — Get Invoice
- POST /api/v1/invoices/{invoice_id}/cancel — Cancel Invoice
- POST /api/v1/invoices/{invoice_id}/dispatch — Dispatch Invoice
- GET /api/v1/invoices/{invoice_id}/pdf — Invoice Pdf
- GET /api/v1/invoices/{invoice_id}/share — Invoice Share
- GET /api/v1/items — List Items
- POST /api/v1/items — Create Item
- PATCH /api/v1/items/{item_id} — Update Item
- GET /api/v1/me/sales — My Sales
- POST /api/v1/orders — Create Order
- GET /api/v1/orders — List Orders
- POST /api/v1/orders/sync — Sync Orders
- GET /api/v1/orders/{order_id} — Get Order
- PUT /api/v1/orders/{order_id} — Edit Order
- POST /api/v1/orders/{order_id}/approve — Approve Order
- POST /api/v1/orders/{order_id}/cancel — Cancel Order
- POST /api/v1/orders/{order_id}/invoice — Raise Invoice
- POST /api/v1/orders/{order_id}/reject — Reject Order
- GET /api/v1/orders/{order_id}/stock-check — Order Stock Check
- POST /api/v1/payments — Create Payment
- GET /api/v1/payments — List Payments
- POST /api/v1/production/runs — Create Run
- GET /api/v1/production/runs — List Runs
- GET /api/v1/production/runs/{rid} — Get Run
- POST /api/v1/production/runs/{rid}/complete — Complete
- POST /api/v1/production/runs/{rid}/issue — Issue
- POST /api/v1/production/runs/{rid}/overheads — Add Overhead
- POST /api/v1/purchases — Create Purchase
- GET /api/v1/purchases — List Purchases
- GET /api/v1/reports — Catalogue
- GET /api/v1/reports/{key} — Report
- GET /api/v1/settings — Get Settings
- PUT /api/v1/settings — Put Settings
- GET /api/v1/suppliers — List Suppliers
- POST /api/v1/suppliers — Create Supplier
- GET /api/v1/users — List Users
- POST /api/v1/users — Create User
- PATCH /api/v1/users/{uid} — Update User
- GET /health — Health
