from datetime import date, timedelta
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models as m
from ..audit import audit
from ..errors import Conflict, NotFound, ValidationFailed
from ..money import pct_bp, round_div
from ..units import qty_view, to_base
from ..util import fy_of, next_number, tolerance_bp
from . import inventory as inv


def get_bom(db: Session, product_id: int) -> m.Bom:
    bom = db.execute(select(m.Bom).where(m.Bom.product_id == product_id)).scalar_one_or_none()
    if not bom:
        raise NotFound("No BOM defined for this product")
    return bom


def save_bom(db: Session, user, product_id: int, yield_qty: int, lines: list[dict]) -> m.Bom:
    product = inv.get_item(db, product_id)
    if product.kind != "FINISHED":
        raise ValidationFailed("BOM can only be defined for finished products")
    seen = set()
    new_lines = []
    for ln in lines:
        it = inv.get_item(db, ln["item_id"])
        if it.kind == "FINISHED" or it.id in seen:
            raise ValidationFailed(f"Invalid or duplicate BOM item {it.name}")
        seen.add(it.id)
        new_lines.append(m.BomLine(item_id=it.id, qty_base=to_base(it, ln["qty"], ln["unit"])))
    if not new_lines:
        raise ValidationFailed("BOM needs at least one line")
    bom = db.execute(select(m.Bom).where(m.Bom.product_id == product_id)).scalar_one_or_none()
    before = None
    if bom:
        before = {"yield": bom.yield_qty, "version": bom.version, "lines": {l.item_id: l.qty_base for l in bom.lines}}
        bom.lines.clear()
        db.flush()
        bom.yield_qty, bom.version = yield_qty, bom.version + 1
    else:
        bom = m.Bom(product_id=product_id, yield_qty=yield_qty, version=1)
        db.add(bom)
    bom.lines.extend(new_lines)
    bom.updated_by = user.id
    db.flush()
    audit(db, user, "BOM_SAVE", "bom", bom.id, before, {"yield": yield_qty, "version": bom.version, "lines": {l.item_id: l.qty_base for l in new_lines}})
    return bom


def create_run(db: Session, user, product_id: int, planned_date: date, batches: Decimal | None = None,
               basis_item_id: int | None = None, basis_qty: Decimal | None = None, basis_unit: str | None = None, notes: str | None = None) -> m.ProductionRun:
    bom = get_bom(db, product_id)
    if basis_item_id is not None:  # "batch size or raw material issued": derive batches from a key ingredient quantity
        line = next((l for l in bom.lines if l.item_id == basis_item_id), None)
        if not line or basis_qty is None:
            raise ValidationFailed("basis item must be in the BOM and basis_qty provided")
        base = to_base(line.item, basis_qty, basis_unit)
        milli = round_div(base * 1000, line.qty_base)
    else:
        milli = int((Decimal(batches if batches is not None else 1) * 1000).to_integral_value())
    if milli <= 0:
        raise ValidationFailed("Batches must be positive")
    fy = fy_of(planned_date)
    run = m.ProductionRun(run_no=f"PR/{fy}/{next_number(db, 'PR', fy):04d}", product_id=product_id, bom_version=bom.version, batches_milli=milli,
                          planned_output=round_div(bom.yield_qty * milli, 1000), planned_date=planned_date, notes=notes, created_by=user.id)
    run.plan_lines = [m.RunPlanLine(item_id=l.item_id, planned_base=round_div(l.qty_base * milli, 1000)) for l in bom.lines]
    db.add(run)
    db.flush()
    audit(db, user, "RUN_CREATE", "production_run", run.id, None, {"run_no": run.run_no, "batches_milli": milli})
    return run


def _issue(db, user, run, lines, mtype, today):
    for ln in lines:
        it = inv.get_item(db, ln["item_id"], lock=True)
        if it.kind == "FINISHED":
            raise ValidationFailed("Cannot issue finished goods to production")
        q = to_base(it, ln["qty"], ln["unit"])
        if q <= 0:
            raise ValidationFailed("Quantity must be positive")
        inv.post(db, it, mtype, -q, today, "production_run", run.id, user.id, narration=ln.get("reason") or f"{run.run_no}")


def issue_materials(db: Session, user, run: m.ProductionRun, lines: list[dict], entry_date: date) -> m.ProductionRun:
    if run.status == "COMPLETED":
        raise Conflict("Run already completed; use stock adjustment for corrections")
    _issue(db, user, run, lines, "PRODUCTION_ISSUE", entry_date)
    run.status = "ISSUED"
    audit(db, user, "RUN_ISSUE", "production_run", run.id, None, {"lines": lines})
    return run


def complete_run(db: Session, user, run: m.ProductionRun, good_output: int, rejected_output: int, packaging_used: list[dict],
                 wastage: list[dict], mfg_date: date) -> m.ProductionRun:
    if run.status == "COMPLETED":
        raise Conflict("Run already completed")
    if run.status == "PLANNED":
        raise Conflict("Issue raw materials before recording output")
    if good_output <= 0:
        raise ValidationFailed("Good output must be positive")
    _issue(db, user, run, packaging_used, "PRODUCTION_ISSUE", mfg_date)
    _issue(db, user, run, wastage, "PRODUCTION_WASTE", mfg_date)
    product = inv.get_item(db, run.product_id, lock=True)
    material = material_cost(db, run.id)
    ovh = sum(o.amount_paise for o in run.overheads)
    run.good_output, run.rejected_output, run.mfg_date = good_output, rejected_output, mfg_date
    run.batch_no = f"{product.sku}-{mfg_date:%y%m%d}-{run.id:03d}"
    run.expiry_date = mfg_date + timedelta(days=product.shelf_life_days) if product.shelf_life_days else None
    inv.post(db, product, "PRODUCTION_OUTPUT", good_output, mfg_date, "production_run", run.id, user.id, value_delta=material + ovh,
             batch_no=run.batch_no, expiry=run.expiry_date, narration=run.run_no)
    run.status, run.completed_by = "COMPLETED", user.id
    from ..models import utcnow
    run.completed_at = utcnow()
    audit(db, user, "RUN_COMPLETE", "production_run", run.id, None, {"good": good_output, "rejected": rejected_output, "batch": run.batch_no})
    return run


def add_overhead(db: Session, user, run: m.ProductionRun, category: str, amount_paise: int, note: str | None, entry_date: date):
    o = m.RunOverhead(run_id=run.id, category=category, amount_paise=amount_paise, note=note, created_by=user.id)
    run.overheads.append(o)
    db.flush()
    if run.status == "COMPLETED":  # run already valued into stock: add the extra cost as a value-only ledger entry
        product = inv.get_item(db, run.product_id)
        inv.post(db, product, "COST_ADJUSTMENT", 0, entry_date, "run_overhead", o.id, user.id, value_delta=amount_paise,
                 batch_no=run.batch_no, expiry=run.expiry_date, narration=f"{category} for {run.run_no}")
    audit(db, user, "RUN_OVERHEAD", "production_run", run.id, None, {"category": category, "amount_paise": amount_paise})
    return o


def material_cost(db: Session, run_id: int) -> int:
    rows = db.execute(select(m.StockLedger).where(m.StockLedger.source_type == "production_run", m.StockLedger.source_id == run_id,
                                                  m.StockLedger.movement_type.in_(("PRODUCTION_ISSUE", "PRODUCTION_WASTE")))).scalars()
    return -sum(r.value_delta_paise for r in rows)


def variance(db: Session, run: m.ProductionRun) -> dict:
    tol = tolerance_bp(db)
    actual: dict[int, int] = {}
    for r in db.execute(select(m.StockLedger).where(m.StockLedger.source_type == "production_run", m.StockLedger.source_id == run.id,
                                                    m.StockLedger.movement_type.in_(("PRODUCTION_ISSUE", "PRODUCTION_WASTE")))).scalars():
        actual[r.item_id] = actual.get(r.item_id, 0) - r.qty_delta
    lines, planned_ids = [], set()
    for pl in run.plan_lines:
        planned_ids.add(pl.item_id)
        a = actual.get(pl.item_id, 0)
        lines.append(_line(pl.item, pl.planned_base, a, tol, run.status == "COMPLETED"))
    for iid, a in actual.items():
        if iid not in planned_ids:
            lines.append(_line(inv.get_item(db, iid), 0, a, tol, True))
    yield_info = None
    if run.good_output is not None:
        bp = pct_bp(run.good_output, run.planned_output)
        yield_info = {"planned": run.planned_output, "actual": run.good_output, "rejected": run.rejected_output, "variance_bp": bp,
                      "variance_pct": f"{bp / 100:.2f}" if bp is not None else None, "flagged": bp is not None and abs(bp) > tol,
                      "direction": None if not bp else ("ADVERSE" if bp < 0 else "FAVOURABLE")}
    flags = [l for l in lines if l["flagged"]] + ([yield_info] if yield_info and yield_info["flagged"] else [])
    return {"tolerance_pct": f"{tol / 100:.2f}", "lines": lines, "yield": yield_info, "flag_count": len(flags)}


def _line(item, planned, actual, tol, final):
    bp = pct_bp(actual, planned)
    flagged = (bp is None and actual > 0) or (bp is not None and (abs(bp) > tol if final else bp > tol))
    return {"item_id": item.id, "name": item.name, "kind": item.kind, "unit": item.display_unit,
            "planned": qty_view(item, planned), "actual": qty_view(item, actual), "difference": qty_view(item, actual - planned),
            "variance_bp": bp, "variance_pct": f"{bp / 100:.2f}" if bp is not None else None, "flagged": flagged,
            "direction": None if not bp else ("ADVERSE" if bp > 0 else "FAVOURABLE")}


def run_cost(db: Session, run: m.ProductionRun) -> dict:
    material = material_cost(db, run.id)
    ovh = sum(o.amount_paise for o in run.overheads)
    total = material + ovh
    good = run.good_output or 0
    cpp = round_div(total, good) if good else None
    price = run.product.selling_price_paise
    return {"material_paise": material, "overhead_paise": ovh, "total_paise": total, "good_output": good,
            "cost_per_packet_paise": cpp, "selling_price_paise": price,
            "margin_paise": (price - cpp) if (cpp is not None and price is not None) else None,
            "margin_pct": f"{(price - cpp) * 100 / price:.2f}" if (cpp is not None and price) else None}


def run_view(db: Session, run: m.ProductionRun, detail: bool = True) -> dict:
    d = {"id": run.id, "run_no": run.run_no, "product_id": run.product_id, "product": run.product.name, "status": run.status,
         "batches": f"{run.batches_milli / 1000:g}", "planned_output": run.planned_output, "good_output": run.good_output,
         "rejected_output": run.rejected_output, "planned_date": run.planned_date, "mfg_date": run.mfg_date, "batch_no": run.batch_no,
         "expiry_date": run.expiry_date, "bom_version": run.bom_version, "notes": run.notes, "created_at": run.created_at}
    if detail:
        d["variance"] = variance(db, run)
        d["cost"] = run_cost(db, run)
        d["overheads"] = [{"id": o.id, "category": o.category, "amount_paise": o.amount_paise, "note": o.note, "created_at": o.created_at} for o in run.overheads]
    return d
