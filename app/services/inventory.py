from datetime import date
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from .. import models as m
from ..errors import InsufficientStock, NotFound, ValidationFailed
from ..money import round_div
from ..units import qty_view, _factor

RECEIPT_TYPES = ("PURCHASE", "PRODUCTION_OUTPUT", "SALE_RETURN")
ISSUE_TYPES = ("PRODUCTION_ISSUE", "PRODUCTION_WASTE", "SALE_DISPATCH")


def get_item(db: Session, item_id: int, lock: bool = False) -> m.Item:
    q = select(m.Item).where(m.Item.id == item_id)
    if lock:
        q = q.with_for_update()  # row lock on Postgres; SQLite serialises writers via BEGIN IMMEDIATE
    it = db.execute(q).scalar_one_or_none()
    if not it:
        raise NotFound(f"Item {item_id} not found")
    return it


def balance(db: Session, item_id: int, batch_no: str | None = None, as_on: date | None = None) -> tuple[int, int]:
    q = select(func.coalesce(func.sum(m.StockLedger.qty_delta), 0), func.coalesce(func.sum(m.StockLedger.value_delta_paise), 0)).where(m.StockLedger.item_id == item_id)
    if batch_no is not None:
        q = q.where(m.StockLedger.batch_no == batch_no)
    if as_on:
        q = q.where(m.StockLedger.entry_date <= as_on)
    qty, val = db.execute(q).one()
    return int(qty), int(val)


def post(db: Session, item: m.Item, mtype: str, qty_delta: int, entry_date: date, source_type: str, source_id: int | None,
         user_id: int | None, value_delta: int | None = None, batch_no: str | None = None, expiry: date | None = None,
         narration: str | None = None) -> m.StockLedger:
    """Single entry point for every stock movement. Issues are valued at the running weighted-average cost."""
    if qty_delta < 0:
        have, val = balance(db, item.id)
        if have < -qty_delta:
            raise InsufficientStock(f"Insufficient stock of {item.name}: need {qty_view(item, -qty_delta)['qty']} {item.display_unit}, have {qty_view(item, have)['qty']} {item.display_unit}",
                                    {"item_id": item.id, "required_base": -qty_delta, "available_base": have})
        if value_delta is None:
            value_delta = -(val if have == -qty_delta else round_div(val * -qty_delta, have))
    if value_delta is None:
        raise ValidationFailed("value required for receipts")
    row = m.StockLedger(item_id=item.id, entry_date=entry_date, movement_type=mtype, qty_delta=qty_delta, value_delta_paise=value_delta,
                        batch_no=batch_no, expiry_date=expiry, source_type=source_type, source_id=source_id, narration=narration, created_by=user_id)
    db.add(row)
    db.flush()
    return row


def wac_paise_per_base(db: Session, item_id: int) -> tuple[int, int]:
    q, v = balance(db, item_id)
    return v, q


def lots(db: Session, item_id: int) -> list[dict]:
    """Finished-goods lots with positive balance, first-expiry-first-out order (unknown expiry = oldest)."""
    rows = db.execute(select(m.StockLedger.batch_no, m.StockLedger.expiry_date, func.sum(m.StockLedger.qty_delta))
                      .where(m.StockLedger.item_id == item_id).group_by(m.StockLedger.batch_no, m.StockLedger.expiry_date)).all()
    out = [{"batch_no": b, "expiry_date": e, "qty": int(q)} for b, e, q in rows if q and q > 0]
    out.sort(key=lambda r: (r["expiry_date"] or date.min, r["batch_no"] or ""))
    return out


def summary(db: Session, kind: str | None = None, as_on: date | None = None) -> list[dict]:
    q = select(m.Item).where(m.Item.is_active.is_(True)).order_by(m.Item.kind, m.Item.name)
    if kind:
        q = q.where(m.Item.kind == kind)
    out = []
    for it in db.execute(q).scalars():
        qty, val = balance(db, it.id, as_on=as_on)
        out.append({"item_id": it.id, "sku": it.sku, "name": it.name, "kind": it.kind, **qty_view(it, qty), "value_paise": val,
                    "avg_cost_paise_per_unit": round_div(val * _factor(it, it.display_unit)[1], qty) if qty else 0,
                    "reorder_level": qty_view(it, it.reorder_level_base)["qty"], "low_stock": it.reorder_level_base > 0 and qty <= it.reorder_level_base})
    return out


def committed_fg(db: Session, item_id: int, exclude_order_id: int | None = None) -> int:
    """Packets promised to customers but not yet physically dispatched (approved orders + open invoice balances)."""
    inv = db.execute(select(func.coalesce(func.sum(m.InvoiceLine.qty - m.InvoiceLine.dispatched_qty), 0))
                     .join(m.Invoice).where(m.InvoiceLine.item_id == item_id, m.Invoice.status == "ISSUED")).scalar_one()
    q = select(func.coalesce(func.sum(m.OrderLine.qty), 0)).join(m.Order).where(m.OrderLine.item_id == item_id, m.Order.status == "APPROVED")
    if exclude_order_id:
        q = q.where(m.Order.id != exclude_order_id)
    return int(inv) + int(db.execute(q).scalar_one())
