from datetime import date
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from .. import models as m, schemas as s
from ..audit import audit
from ..db import get_db
from ..deps import ADMIN, require
from ..errors import Conflict, NotFound, ValidationFailed
from ..money import mul_div
from ..services import costing, inventory as inv, production as prod
from ..units import _factor, qty_view, to_base
from ..util import fy_of, next_number, today_ist

router = APIRouter(tags=["operations"])
READ = require("ADMIN", "PRODUCTION", "OWNER", "ACCOUNTANT")
WRITE = require("ADMIN", "PRODUCTION")


def _run(db, rid) -> m.ProductionRun:
    r = db.get(m.ProductionRun, rid)
    if not r:
        raise NotFound("Production run not found")
    return r


@router.post("/production/runs", status_code=201)
def create_run(body: s.RunIn, user: m.User = Depends(WRITE), db: Session = Depends(get_db)):
    if body.batches is None and body.basis_item_id is None:
        body.batches = 1
    r = prod.create_run(db, user, body.product_id, body.planned_date or today_ist(), body.batches, body.basis_item_id, body.basis_qty, body.basis_unit, body.notes)
    db.commit()
    return prod.run_view(db, r)


@router.get("/production/runs")
def list_runs(status: str | None = None, limit: int = Query(50, le=200), offset: int = Query(0, ge=0), _: m.User = Depends(READ), db: Session = Depends(get_db)):
    q = select(m.ProductionRun)
    if status:
        q = q.where(m.ProductionRun.status == status)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(q.order_by(m.ProductionRun.id.desc()).limit(limit).offset(offset)).scalars().all()
    return {"total": total, "items": [prod.run_view(db, r, detail=False) | {"flag_count": prod.variance(db, r)["flag_count"]} for r in rows]}


@router.get("/production/runs/{rid}")
def get_run(rid: int, _: m.User = Depends(READ), db: Session = Depends(get_db)):
    r = _run(db, rid)
    d = prod.run_view(db, r)
    d["plan"] = [{"item_id": p.item_id, "name": p.item.name, **qty_view(p.item, p.planned_base)} for p in r.plan_lines]
    return d


@router.post("/production/runs/{rid}/issue")
def issue(rid: int, body: s.IssueIn, user: m.User = Depends(WRITE), db: Session = Depends(get_db)):
    r = _run(db, rid)
    prod.issue_materials(db, user, r, [l.model_dump() for l in body.lines], body.issue_date or today_ist())
    db.commit()
    return prod.run_view(db, r)


@router.post("/production/runs/{rid}/complete")
def complete(rid: int, body: s.CompleteIn, user: m.User = Depends(WRITE), db: Session = Depends(get_db)):
    r = _run(db, rid)
    prod.complete_run(db, user, r, body.good_output, body.rejected_output, [l.model_dump() for l in body.packaging_used], [l.model_dump() for l in body.wastage], body.mfg_date or today_ist())
    db.commit()
    return prod.run_view(db, r)


@router.post("/production/runs/{rid}/overheads", status_code=201)
def add_overhead(rid: int, body: s.OverheadIn, user: m.User = Depends(WRITE), db: Session = Depends(get_db)):
    r = _run(db, rid)
    prod.add_overhead(db, user, r, body.category, body.amount_paise, body.note, today_ist())
    db.commit()
    return prod.run_view(db, r)


@router.post("/costing/monthly-overheads", status_code=201)
def monthly_overhead(body: s.MonthlyOverheadIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    o = m.MonthlyOverhead(month=body.month, category=body.category, amount_paise=body.amount_paise, note=body.note, created_by=user.id)
    db.add(o)
    db.flush()
    audit(db, user, "MONTHLY_OVERHEAD", "monthly_overhead", o.id, None, body.model_dump())
    db.commit()
    return {"id": o.id, **body.model_dump()}


@router.get("/costing")
def costing_view(month: str = Query(pattern=r"^\d{4}-(0[1-9]|1[0-2])$"), _: m.User = Depends(require("ADMIN", "OWNER", "ACCOUNTANT")), db: Session = Depends(get_db)):
    return costing.monthly_costing(db, month)


# ---------------- inventory ----------------
@router.get("/inventory/summary")
def inv_summary(kind: str | None = None, as_on: date | None = None, _: m.User = Depends(READ), db: Session = Depends(get_db)):
    return inv.summary(db, kind, as_on)


@router.get("/inventory/ledger")
def inv_ledger(item_id: int | None = None, source_type: str | None = None, source_id: int | None = None, from_date: date | None = None, to_date: date | None = None,
               limit: int = Query(100, le=500), offset: int = Query(0, ge=0), _: m.User = Depends(READ), db: Session = Depends(get_db)):
    q = select(m.StockLedger)
    for col, val in ((m.StockLedger.item_id, item_id), (m.StockLedger.source_type, source_type), (m.StockLedger.source_id, source_id)):
        if val is not None:
            q = q.where(col == val)
    if from_date:
        q = q.where(m.StockLedger.entry_date >= from_date)
    if to_date:
        q = q.where(m.StockLedger.entry_date <= to_date)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(q.order_by(m.StockLedger.id.desc()).limit(limit).offset(offset)).scalars().all()
    return {"total": total, "items": [{"id": e.id, "item_id": e.item_id, "item": e.item.name, "date": e.entry_date, "movement_type": e.movement_type, **qty_view(e.item, e.qty_delta),
                                       "value_delta_paise": e.value_delta_paise, "batch_no": e.batch_no, "expiry_date": e.expiry_date, "source_type": e.source_type, "source_id": e.source_id,
                                       "narration": e.narration} for e in rows]}


@router.get("/inventory/lots")
def fg_lots(_: m.User = Depends(READ), db: Session = Depends(get_db)):
    out = []
    for it in db.execute(select(m.Item).where(m.Item.kind == "FINISHED")).scalars():
        out += [{"item_id": it.id, "product": it.name, **l} for l in inv.lots(db, it.id)]
    return out


@router.post("/inventory/adjustments", status_code=201)
def adjustment(body: s.AdjustmentIn, user: m.User = Depends(WRITE), db: Session = Depends(get_db)):
    it = inv.get_item(db, body.item_id, lock=True)
    base = to_base(it, abs(body.qty), body.unit)
    if base == 0:
        raise ValidationFailed("Adjustment quantity is zero")
    if body.qty > 0:
        if body.value_paise is None:
            raise ValidationFailed("value_paise is required when adding stock")
        row = inv.post(db, it, "ADJUSTMENT", base, today_ist(), "adjustment", None, user.id, value_delta=body.value_paise, batch_no=body.batch_no, narration=body.reason)
    else:
        row = inv.post(db, it, "ADJUSTMENT", -base, today_ist(), "adjustment", None, user.id, batch_no=body.batch_no, narration=body.reason)
    audit(db, user, "STOCK_ADJUST", "item", it.id, None, {"qty_base": row.qty_delta, "reason": body.reason})
    db.commit()
    return {"ledger_id": row.id, **qty_view(it, row.qty_delta), "value_delta_paise": row.value_delta_paise}


@router.get("/inventory/reconcile")
def reconcile(_: m.User = Depends(require("ADMIN", "ACCOUNTANT", "OWNER")), db: Session = Depends(get_db)):
    """Integrity checks: ledger vs source documents. Every row should say ok=true."""
    checks = []
    for it in db.execute(select(m.Item).where(m.Item.kind == "FINISHED")).scalars():
        led = inv.balance(db, it.id)[0]
        produced = db.execute(select(func.coalesce(func.sum(m.StockLedger.qty_delta), 0)).where(m.StockLedger.item_id == it.id, m.StockLedger.movement_type == "PRODUCTION_OUTPUT")).scalar_one()
        runs = db.execute(select(func.coalesce(func.sum(m.ProductionRun.good_output), 0)).where(m.ProductionRun.product_id == it.id, m.ProductionRun.status == "COMPLETED")).scalar_one()
        checks.append({"check": f"{it.name}: ledger production receipts = completed runs' good output", "ledger": int(produced), "documents": int(runs), "ok": int(produced) == int(runs)})
        disp = db.execute(select(func.coalesce(func.sum(m.StockLedger.qty_delta), 0)).where(m.StockLedger.item_id == it.id, m.StockLedger.movement_type == "SALE_DISPATCH")).scalar_one()
        dl = db.execute(select(func.coalesce(func.sum(m.DispatchLine.qty), 0)).where(m.DispatchLine.item_id == it.id)).scalar_one()
        checks.append({"check": f"{it.name}: ledger dispatches = dispatch documents", "ledger": -int(disp), "documents": int(dl), "ok": -int(disp) == int(dl)})
        checks.append({"check": f"{it.name}: no negative stock", "ledger": led, "documents": None, "ok": led >= 0})
    neg = [i.name for i in db.execute(select(m.Item)).scalars() if inv.balance(db, i.id)[0] < 0]
    checks.append({"check": "No item has negative stock", "ledger": len(neg), "documents": 0, "ok": not neg})
    return {"ok": all(c["ok"] for c in checks), "checks": checks}


# ---------------- purchases ----------------
def _purchase_view(p: m.Purchase) -> dict:
    return {"id": p.id, "purchase_no": p.purchase_no, "supplier_id": p.supplier_id, "supplier": p.supplier.name, "supplier_invoice_no": p.supplier_invoice_no, "purchase_date": p.purchase_date,
            "taxable_paise": p.taxable_paise, "tax_paise": p.tax_paise, "total_paise": p.total_paise,
            "lines": [{"item_id": l.item_id, "item": l.item.name, **qty_view(l.item, l.qty_base), "rate_paise": l.rate_paise, "rate_unit": l.rate_unit, "value_paise": l.value_paise, "tax_paise": l.tax_paise} for l in p.lines]}


@router.post("/purchases", status_code=201)
def create_purchase(body: s.PurchaseIn, response: Response, user: m.User = Depends(WRITE), db: Session = Depends(get_db)):
    if body.client_ref:
        ex = db.execute(select(m.Purchase).where(m.Purchase.client_ref == body.client_ref)).scalar_one_or_none()
        if ex:
            response.status_code = 200
            return _purchase_view(ex)
    if not db.get(m.Supplier, body.supplier_id):
        raise NotFound("Supplier not found")
    d = body.purchase_date or today_ist()
    fy = fy_of(d)
    p = m.Purchase(purchase_no=f"PUR/{fy}/{next_number(db, 'PUR', fy):04d}", supplier_id=body.supplier_id, supplier_invoice_no=body.supplier_invoice_no, purchase_date=d, client_ref=body.client_ref, created_by=user.id)
    taxable = tax = 0
    for ln in body.lines:
        it = inv.get_item(db, ln.item_id, lock=True)
        if it.kind == "FINISHED":
            raise ValidationFailed("Finished goods are produced, not purchased")
        base = to_base(it, ln.qty, ln.unit)
        value = mul_div(base, ln.rate_paise, _factor(it, ln.unit)[1]) if ln.unit.lower() != "carton" else 0
        t = mul_div(value, ln.gst_rate_bp, 10000)
        p.lines.append(m.PurchaseLine(item_id=it.id, qty_base=base, rate_paise=ln.rate_paise, rate_unit=ln.unit.lower(), value_paise=value, gst_rate_bp=ln.gst_rate_bp, tax_paise=t))
        taxable += value; tax += t
    p.taxable_paise, p.tax_paise, p.total_paise = taxable, tax, taxable + tax
    db.add(p)
    db.flush()
    for l in p.lines:
        inv.post(db, l.item, "PURCHASE", l.qty_base, d, "purchase", p.id, user.id, value_delta=l.value_paise, narration=p.supplier.name)
    audit(db, user, "PURCHASE", "purchase", p.id, None, {"purchase_no": p.purchase_no, "taxable_paise": taxable})
    db.commit()
    return _purchase_view(p)


@router.get("/purchases")
def list_purchases(limit: int = Query(50, le=200), offset: int = Query(0, ge=0), _: m.User = Depends(READ), db: Session = Depends(get_db)):
    total = db.execute(select(func.count()).select_from(m.Purchase)).scalar_one()
    return {"total": total, "items": [_purchase_view(p) for p in db.execute(select(m.Purchase).order_by(m.Purchase.id.desc()).limit(limit).offset(offset)).scalars()]}
