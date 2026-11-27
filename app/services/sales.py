from datetime import date, datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models as m
from ..audit import audit
from ..errors import Conflict, Forbidden, InsufficientStock, NotFound, ValidationFailed
from ..units import to_base
from ..util import company, fy_of, next_number, today_ist
from . import inventory as inv
from .gst import round_to_rupee, split_tax


# ---------------- pricing & orders ----------------
def price_for(db: Session, customer_id: int, item: m.Item) -> int:
    cp = db.execute(select(m.CustomerPrice).where(m.CustomerPrice.customer_id == customer_id, m.CustomerPrice.item_id == item.id)).scalar_one_or_none()
    if cp:
        return cp.price_paise
    if item.selling_price_paise is None:
        raise ValidationFailed(f"{item.name} has no selling price in the price list")
    return item.selling_price_paise


def _build_lines(db, customer_id, raw_lines):
    merged: dict[int, int] = {}
    for ln in raw_lines:
        it = inv.get_item(db, ln["item_id"])
        if it.kind != "FINISHED" or not it.is_active:
            raise ValidationFailed(f"{it.name} cannot be sold")
        packets = to_base(it, ln["qty"], ln.get("unit") or "packet")
        if packets <= 0:
            raise ValidationFailed("Quantity must be positive")
        merged[it.id] = merged.get(it.id, 0) + packets
    if not merged:
        raise ValidationFailed("Order needs at least one line")
    out = []
    for iid, packets in merged.items():
        it = inv.get_item(db, iid)
        price = price_for(db, customer_id, it)  # server decides the price; never trust the phone
        out.append(m.OrderLine(item_id=iid, qty=packets, price_paise=price, orig_qty=packets, orig_price_paise=price))
    return out


def create_order(db: Session, user, customer_id: int, lines: list[dict], client_ref: str, notes: str | None, taken_at: datetime | None):
    existing = db.execute(select(m.Order).where(m.Order.client_ref == client_ref)).scalar_one_or_none()
    if existing:  # idempotent retry (flaky network / offline sync)
        if existing.salesman_id != user.id:
            raise Conflict("client_ref already used")
        return existing, False
    cust = db.get(m.Customer, customer_id)
    if not cust or not cust.is_active:
        raise NotFound("Customer not found")
    if user.role == "SALESMAN" and cust.salesman_id not in (None, user.id):
        raise Forbidden("This customer is assigned to another salesman")
    fy = fy_of(today_ist())
    order = m.Order(order_no=f"ORD/{fy}/{next_number(db, 'ORD', fy):05d}", client_ref=client_ref, customer_id=customer_id,
                    salesman_id=user.id, notes=notes, taken_at=taken_at)
    order.lines = _build_lines(db, customer_id, lines)
    db.add(order)
    db.flush()
    audit(db, user, "ORDER_SUBMIT", "order", order.id, None, {"order_no": order.order_no, "customer_id": customer_id})
    return order, True


def edit_order(db: Session, user, order: m.Order, lines: list[dict]):
    if order.status != "SUBMITTED":
        raise Conflict("Only submitted orders can be edited")
    before = [(l.item_id, l.qty, l.price_paise) for l in order.lines]
    orig = {l.item_id: (l.orig_qty, l.orig_price_paise) for l in order.lines}
    new = []
    for ln in lines:
        it = inv.get_item(db, ln["item_id"])
        if it.kind != "FINISHED":
            raise ValidationFailed("Only finished products can be ordered")
        q = to_base(it, ln["qty"], ln.get("unit") or "packet")
        if q <= 0:
            raise ValidationFailed("Quantity must be positive")
        price = ln.get("price_paise")
        if price is None:
            price = price_for(db, order.customer_id, it)
        oq, op = orig.get(it.id, (q, price))
        new.append(m.OrderLine(item_id=it.id, qty=q, price_paise=price, orig_qty=oq, orig_price_paise=op))
    if len({n.item_id for n in new}) != len(new) or not new:
        raise ValidationFailed("Duplicate or empty lines")
    order.lines.clear()
    db.flush()
    order.lines.extend(new)
    db.flush()
    audit(db, user, "ORDER_EDIT", "order", order.id, {"lines": before}, {"lines": [(l.item_id, l.qty, l.price_paise) for l in new]})


def stock_check(db: Session, order: m.Order) -> dict:
    lines, ok = [], True
    for l in order.lines:
        on_hand, _ = inv.balance(db, l.item_id)
        committed = inv.committed_fg(db, l.item_id, exclude_order_id=order.id)
        available = max(on_hand - committed, 0)
        short = max(l.qty - available, 0)
        ok = ok and short == 0
        batches = None
        if short:
            bom = db.execute(select(m.Bom).where(m.Bom.product_id == l.item_id)).scalar_one_or_none()
            if bom:
                batches = -(-short // bom.yield_qty)
        lines.append({"item_id": l.item_id, "name": l.item.name, "required": l.qty, "on_hand": on_hand, "committed_to_others": committed,
                      "available": available, "shortage": short, "suggested_batches_to_produce": batches})
    return {"order_id": order.id, "sufficient": ok, "lines": lines}


def approve(db: Session, user, order: m.Order, accept_shortage: bool):
    if order.status != "SUBMITTED":
        raise Conflict(f"Order is {order.status}; only SUBMITTED orders can be approved")
    for l in order.lines:
        inv.get_item(db, l.item_id, lock=True)
    chk = stock_check(db, order)
    if not chk["sufficient"] and not accept_shortage:
        raise InsufficientStock("Finished-goods stock does not cover this order. Reduce the quantity, approve as back-order, or reject.", chk)
    order.status = "APPROVED"
    audit(db, user, "ORDER_APPROVE", "order", order.id, None, {"accepted_shortage": not chk["sufficient"]})
    return chk


def reject(db: Session, user, order: m.Order, reason: str):
    if order.status != "SUBMITTED":
        raise Conflict("Only SUBMITTED orders can be rejected")
    order.status, order.rejection_reason = "REJECTED", reason
    audit(db, user, "ORDER_REJECT", "order", order.id, None, {"reason": reason})


def cancel_order(db: Session, user, order: m.Order):
    if order.status != "SUBMITTED":
        raise Conflict("Only SUBMITTED orders can be cancelled")
    order.status = "CANCELLED"
    audit(db, user, "ORDER_CANCEL", "order", order.id)


# ---------------- invoices ----------------
def create_invoice(db: Session, user, order: m.Order) -> m.Invoice:
    if order.status != "APPROVED":
        raise Conflict("Only APPROVED orders can be invoiced")
    cust, co = order.customer, None
    co = company(db)
    today = today_ist()
    fy = fy_of(today)
    intra = cust.state_code == co["state_code"]
    inv_row = m.Invoice(invoice_no=f"{co['invoice_prefix']}/{fy}/{next_number(db, 'INV', fy):04d}", fy=fy, order_id=order.id, customer_id=cust.id,
                        invoice_date=today, supply_type="INTRA" if intra else "INTER", place_of_supply=cust.state_code, buyer_name=cust.name,
                        buyer_gstin=cust.gstin, buyer_address=cust.address, taxable_paise=0, total_paise=0, created_by=user.id)
    taxable_t = cgst_t = sgst_t = igst_t = 0
    for l in order.lines:
        taxable = l.qty * l.price_paise
        cg, sg, ig = split_tax(taxable, l.item.gst_rate_bp, intra)
        inv_row.lines.append(m.InvoiceLine(item_id=l.item_id, description=l.item.name, hsn_code=l.item.hsn_code, qty=l.qty, price_paise=l.price_paise,
                                           taxable_paise=taxable, gst_rate_bp=l.item.gst_rate_bp, cgst_paise=cg, sgst_paise=sg, igst_paise=ig))
        taxable_t += taxable; cgst_t += cg; sgst_t += sg; igst_t += ig
    gross = taxable_t + cgst_t + sgst_t + igst_t
    total, ro = round_to_rupee(gross)
    inv_row.taxable_paise, inv_row.cgst_paise, inv_row.sgst_paise, inv_row.igst_paise = taxable_t, cgst_t, sgst_t, igst_t
    inv_row.round_off_paise, inv_row.total_paise = ro, total
    db.add(inv_row)
    order.status = "INVOICED"
    db.flush()
    audit(db, user, "INVOICE_CREATE", "invoice", inv_row.id, None, {"invoice_no": inv_row.invoice_no, "total_paise": total})
    return inv_row


def dispatch(db: Session, user, invoice: m.Invoice, lines: list[dict] | None, vehicle_no: str | None, notes: str | None) -> m.Dispatch:
    if invoice.status != "ISSUED":
        raise Conflict("Cannot dispatch a cancelled invoice")
    remaining = {l.id: l.qty - l.dispatched_qty for l in invoice.lines}
    req = {k: v for k, v in remaining.items() if v > 0}
    if lines:
        req = {}
        for ln in lines:
            if ln["invoice_line_id"] not in remaining:
                raise ValidationFailed("Line does not belong to this invoice")
            if ln["qty"] <= 0 or ln["qty"] > remaining[ln["invoice_line_id"]]:
                raise ValidationFailed("Dispatch quantity exceeds the undispatched balance")
            req[ln["invoice_line_id"]] = ln["qty"]
    if not req:
        raise Conflict("Nothing left to dispatch")
    today = today_ist()
    fy = fy_of(today)
    d = m.Dispatch(dispatch_no=f"DSP/{fy}/{next_number(db, 'DSP', fy):04d}", invoice_id=invoice.id, dispatch_date=today, vehicle_no=vehicle_no, notes=notes, created_by=user.id)
    db.add(d)
    db.flush()
    by_id = {l.id: l for l in invoice.lines}
    shortages = []
    for lid, qty in req.items():  # pre-check everything so a partial failure leaves nothing half-posted
        il = by_id[lid]
        inv.get_item(db, il.item_id, lock=True)
        have, _ = inv.balance(db, il.item_id)
        if have < qty:
            shortages.append({"item_id": il.item_id, "name": il.description, "required": qty, "on_hand": have, "shortage": qty - have})
    if shortages:
        raise InsufficientStock("Not enough finished goods in stock to dispatch", {"lines": shortages})
    for lid, qty in req.items():
        il = by_id[lid]
        item = inv.get_item(db, il.item_id)
        need = qty
        for lot in inv.lots(db, il.item_id):  # FEFO
            take = min(need, lot["qty"])
            row = inv.post(db, item, "SALE_DISPATCH", -take, today, "dispatch", d.id, user.id, batch_no=lot["batch_no"], expiry=lot["expiry_date"], narration=invoice.invoice_no)
            d.lines.append(m.DispatchLine(invoice_line_id=lid, item_id=il.item_id, qty=take, batch_no=lot["batch_no"], expiry_date=lot["expiry_date"], value_paise=-row.value_delta_paise))
            need -= take
            if need == 0:
                break
        il.dispatched_qty += qty
    db.flush()
    full = all(l.dispatched_qty == l.qty for l in invoice.lines)
    invoice.dispatch_status = "FULL" if full else "PARTIAL"
    if full:
        invoice.order.status = "DISPATCHED"
    audit(db, user, "DISPATCH", "invoice", invoice.id, None, {"dispatch_no": d.dispatch_no, "lines": req})
    return d


def cancel_invoice(db: Session, user, invoice: m.Invoice, reason: str) -> m.CreditNote:
    if invoice.status != "ISSUED":
        raise Conflict("Invoice already cancelled")
    paid = db.execute(select(m.PaymentAllocation).where(m.PaymentAllocation.invoice_id == invoice.id)).first()
    if paid:
        raise Conflict("Payments are allocated to this invoice; reverse/adjust them before cancelling")
    today = today_ist()
    fy = fy_of(today)
    cn = m.CreditNote(cn_no=f"CN/{fy}/{next_number(db, 'CN', fy):04d}", invoice_id=invoice.id, cn_date=today, reason=reason, taxable_paise=invoice.taxable_paise,
                      cgst_paise=invoice.cgst_paise, sgst_paise=invoice.sgst_paise, igst_paise=invoice.igst_paise, round_off_paise=invoice.round_off_paise,
                      total_paise=invoice.total_paise, created_by=user.id)
    returned = False
    for d in db.execute(select(m.Dispatch).where(m.Dispatch.invoice_id == invoice.id)).scalars():
        for dl in d.lines:
            item = inv.get_item(db, dl.item_id)
            inv.post(db, item, "SALE_RETURN", dl.qty, today, "credit_note", invoice.id, user.id, value_delta=dl.value_paise, batch_no=dl.batch_no,
                     expiry=dl.expiry_date, narration=f"Return on cancellation of {invoice.invoice_no}")
            returned = True
    cn.stock_returned = returned
    db.add(cn)
    invoice.status, invoice.cancelled_at, invoice.cancel_reason = "CANCELLED", datetime.utcnow(), reason
    invoice.order.status = "CANCELLED"
    db.flush()
    audit(db, user, "INVOICE_CANCEL", "invoice", invoice.id, {"status": "ISSUED"}, {"status": "CANCELLED", "credit_note": cn.cn_no, "reason": reason})
    return cn


# ---------------- serialisers ----------------
def order_view(o: m.Order, db: Session | None = None) -> dict:
    inv_row = o.__dict__.get("_inv")
    return {"id": o.id, "order_no": o.order_no, "client_ref": o.client_ref, "status": o.status, "customer_id": o.customer_id,
            "customer": o.customer.name, "customer_state": o.customer.state_code, "salesman": o.salesman.full_name, "salesman_id": o.salesman_id,
            "notes": o.notes, "rejection_reason": o.rejection_reason, "created_at": o.created_at, "taken_at": o.taken_at,
            "total_paise": sum(l.qty * l.price_paise for l in o.lines),
            "lines": [{"id": l.id, "item_id": l.item_id, "name": l.item.name, "qty": l.qty, "price_paise": l.price_paise,
                       "orig_qty": l.orig_qty, "orig_price_paise": l.orig_price_paise, "amount_paise": l.qty * l.price_paise} for l in o.lines]}


def invoice_view(i: m.Invoice, outstanding: int | None = None) -> dict:
    return {"id": i.id, "invoice_no": i.invoice_no, "fy": i.fy, "order_id": i.order_id, "customer_id": i.customer_id, "buyer_name": i.buyer_name,
            "buyer_gstin": i.buyer_gstin, "invoice_date": i.invoice_date, "supply_type": i.supply_type, "place_of_supply": i.place_of_supply,
            "taxable_paise": i.taxable_paise, "cgst_paise": i.cgst_paise, "sgst_paise": i.sgst_paise, "igst_paise": i.igst_paise,
            "round_off_paise": i.round_off_paise, "total_paise": i.total_paise, "status": i.status, "dispatch_status": i.dispatch_status,
            "cancel_reason": i.cancel_reason, "outstanding_paise": outstanding,
            "lines": [{"id": l.id, "item_id": l.item_id, "description": l.description, "hsn_code": l.hsn_code, "qty": l.qty, "price_paise": l.price_paise,
                       "taxable_paise": l.taxable_paise, "gst_rate_bp": l.gst_rate_bp, "cgst_paise": l.cgst_paise, "sgst_paise": l.sgst_paise,
                       "igst_paise": l.igst_paise, "dispatched_qty": l.dispatched_qty} for l in i.lines]}
