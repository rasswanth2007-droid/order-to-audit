from datetime import date
from urllib.parse import quote
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from .. import models as m, schemas as s
from ..db import get_db
from ..deps import ADMIN, current_user, require
from ..errors import Forbidden, NotFound
from ..money import fmt_inr
from ..services import inventory as inv, payments as pay, sales as svc
from ..services.invoice_pdf import render_invoice
from ..util import company, today_ist

router = APIRouter(tags=["sales"])
SALES_ROLES = require("ADMIN", "SALESMAN")
VIEWERS = require("ADMIN", "OWNER", "ACCOUNTANT")


def _page(limit: int, offset: int): return max(1, min(limit, 200)), max(0, offset)


def _get_order(db, order_id, user) -> m.Order:
    o = db.get(m.Order, order_id)
    if not o or (user.role == "SALESMAN" and o.salesman_id != user.id):  # same 404 for foreign orders: no IDOR/enumeration
        raise NotFound("Order not found")
    return o


def _order_out(db, o):
    d = svc.order_view(o)
    i = db.execute(select(m.Invoice).where(m.Invoice.order_id == o.id)).scalar_one_or_none()
    d["invoice"] = {"id": i.id, "invoice_no": i.invoice_no, "status": i.status, "dispatch_status": i.dispatch_status, "total_paise": i.total_paise} if i else None
    return d


@router.post("/orders", status_code=201)
def create_order(body: s.OrderIn, response: Response, user: m.User = Depends(SALES_ROLES), db: Session = Depends(get_db)):
    o, created = svc.create_order(db, user, body.customer_id, [l.model_dump() for l in body.lines], body.client_ref, body.notes, body.taken_at)
    db.commit()
    response.status_code = 201 if created else 200
    return {**_order_out(db, o), "duplicate": not created}


@router.post("/orders/sync")
def sync_orders(body: s.OrderSync, user: m.User = Depends(SALES_ROLES), db: Session = Depends(get_db)):
    """Offline queue upload. Each order is processed independently so one bad order doesn't block the rest."""
    results = []
    for o in body.orders:
        try:
            order, created = svc.create_order(db, user, o.customer_id, [l.model_dump() for l in o.lines], o.client_ref, o.notes, o.taken_at)
            db.commit()
            results.append({"client_ref": o.client_ref, "ok": True, "duplicate": not created, "order_no": order.order_no, "order_id": order.id})
        except Exception as e:  # noqa: BLE001
            db.rollback()
            if not hasattr(e, "message"):
                raise
            results.append({"client_ref": o.client_ref, "ok": False, "code": e.code, "error": e.message})
    return {"results": results}


@router.get("/orders")
def list_orders(status: str | None = None, customer_id: int | None = None, from_date: date | None = None, to_date: date | None = None,
                limit: int = Query(50), offset: int = Query(0), user: m.User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("ADMIN", "SALESMAN", "OWNER", "ACCOUNTANT"):
        raise Forbidden("Not allowed")
    limit, offset = _page(limit, offset)
    q = select(m.Order)
    if user.role == "SALESMAN":
        q = q.where(m.Order.salesman_id == user.id)
    if status:
        q = q.where(m.Order.status == status)
    if customer_id:
        q = q.where(m.Order.customer_id == customer_id)
    if from_date:
        q = q.where(func.date(m.Order.created_at) >= from_date)
    if to_date:
        q = q.where(func.date(m.Order.created_at) <= to_date)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(q.order_by(m.Order.id.desc()).limit(limit).offset(offset)).scalars().all()
    return {"total": total, "items": [_order_out(db, o) for o in rows]}


@router.get("/orders/{order_id}")
def get_order(order_id: int, user: m.User = Depends(SALES_ROLES), db: Session = Depends(get_db)):
    return _order_out(db, _get_order(db, order_id, user))


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, user: m.User = Depends(SALES_ROLES), db: Session = Depends(get_db)):
    o = _get_order(db, order_id, user)
    svc.cancel_order(db, user, o)
    db.commit()
    return _order_out(db, o)


@router.get("/orders/{order_id}/stock-check")
def order_stock_check(order_id: int, _admin: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    o = db.get(m.Order, order_id)
    if not o:
        raise NotFound("Order not found")
    return svc.stock_check(db, o)


@router.put("/orders/{order_id}")
def edit_order(order_id: int, body: s.OrderEdit, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    o = db.get(m.Order, order_id)
    if not o:
        raise NotFound("Order not found")
    svc.edit_order(db, user, o, [l.model_dump() for l in body.lines])
    db.commit()
    return _order_out(db, o)


@router.post("/orders/{order_id}/approve")
def approve_order(order_id: int, body: s.ApproveIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    o = db.get(m.Order, order_id)
    if not o:
        raise NotFound("Order not found")
    chk = svc.approve(db, user, o, body.accept_shortage)
    invoice = svc.create_invoice(db, user, o) if body.raise_invoice else None
    db.commit()
    return {"order": _order_out(db, o), "stock_check": chk, "invoice": svc.invoice_view(invoice) if invoice else None}


@router.post("/orders/{order_id}/reject")
def reject_order(order_id: int, body: s.RejectIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    o = db.get(m.Order, order_id)
    if not o:
        raise NotFound("Order not found")
    svc.reject(db, user, o, body.reason)
    db.commit()
    return _order_out(db, o)


@router.post("/orders/{order_id}/invoice", status_code=201)
def raise_invoice(order_id: int, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    o = db.get(m.Order, order_id)
    if not o:
        raise NotFound("Order not found")
    i = svc.create_invoice(db, user, o)
    db.commit()
    return svc.invoice_view(i, pay.invoice_outstanding(db, i))


@router.get("/me/sales")
def my_sales(from_date: date | None = None, to_date: date | None = None, user: m.User = Depends(require("SALESMAN", "ADMIN")), db: Session = Depends(get_db)):
    """Salesman's customer-wise sales (value of approved-and-beyond orders)."""
    q = select(m.Order).where(m.Order.salesman_id == user.id, m.Order.status.in_(("APPROVED", "INVOICED", "DISPATCHED")))
    if from_date:
        q = q.where(func.date(m.Order.created_at) >= from_date)
    if to_date:
        q = q.where(func.date(m.Order.created_at) <= to_date)
    agg: dict[int, dict] = {}
    for o in db.execute(q).scalars():
        r = agg.setdefault(o.customer_id, {"customer_id": o.customer_id, "customer": o.customer.name, "orders": 0, "value_paise": 0})
        r["orders"] += 1
        r["value_paise"] += sum(l.qty * l.price_paise for l in o.lines)
    counts = dict(db.execute(select(m.Order.status, func.count()).where(m.Order.salesman_id == user.id).group_by(m.Order.status)).all())
    return {"customers": sorted(agg.values(), key=lambda r: -r["value_paise"]), "total_value_paise": sum(r["value_paise"] for r in agg.values()), "orders_by_status": counts}


@router.get("/availability")
def fg_availability(user: m.User = Depends(SALES_ROLES), db: Session = Depends(get_db)):
    """Finished-goods packets free to promise (on hand minus committed). Lets the phone warn about stock before submitting."""
    out = []
    for it in db.execute(select(m.Item).where(m.Item.kind == "FINISHED", m.Item.is_active.is_(True)).order_by(m.Item.name)).scalars():
        on_hand, _ = inv.balance(db, it.id)
        out.append({"item_id": it.id, "name": it.name, "available": max(on_hand - inv.committed_fg(db, it.id), 0), "price_paise": it.selling_price_paise})
    return out


# ---------------- invoices ----------------
@router.get("/invoices")
def list_invoices(status: str | None = None, customer_id: int | None = None, from_date: date | None = None, to_date: date | None = None,
                  limit: int = Query(50), offset: int = Query(0), _: m.User = Depends(VIEWERS), db: Session = Depends(get_db)):
    limit, offset = _page(limit, offset)
    q = select(m.Invoice)
    if status:
        q = q.where(m.Invoice.status == status)
    if customer_id:
        q = q.where(m.Invoice.customer_id == customer_id)
    if from_date:
        q = q.where(m.Invoice.invoice_date >= from_date)
    if to_date:
        q = q.where(m.Invoice.invoice_date <= to_date)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(q.order_by(m.Invoice.id.desc()).limit(limit).offset(offset)).scalars().all()
    return {"total": total, "items": [svc.invoice_view(i, pay.invoice_outstanding(db, i)) for i in rows]}


def _inv_for(db, user, invoice_id) -> m.Invoice:
    i = db.get(m.Invoice, invoice_id)
    if not i or (user.role == "SALESMAN" and i.order.salesman_id != user.id):
        raise NotFound("Invoice not found")
    if user.role in ("PRODUCTION",):
        raise Forbidden("Not allowed")
    return i


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int, user: m.User = Depends(current_user), db: Session = Depends(get_db)):
    i = _inv_for(db, user, invoice_id)
    d = svc.invoice_view(i, pay.invoice_outstanding(db, i))
    d["dispatches"] = [{"id": x.id, "dispatch_no": x.dispatch_no, "date": x.dispatch_date, "vehicle_no": x.vehicle_no,
                        "lines": [{"item_id": l.item_id, "qty": l.qty, "batch_no": l.batch_no, "expiry_date": l.expiry_date} for l in x.lines]}
                       for x in db.execute(select(m.Dispatch).where(m.Dispatch.invoice_id == i.id)).scalars()]
    cn = db.execute(select(m.CreditNote).where(m.CreditNote.invoice_id == i.id)).scalar_one_or_none()
    d["credit_note"] = {"cn_no": cn.cn_no, "date": cn.cn_date, "reason": cn.reason, "total_paise": cn.total_paise, "stock_returned": cn.stock_returned} if cn else None
    return d


@router.get("/invoices/{invoice_id}/pdf")
def invoice_pdf(invoice_id: int, user: m.User = Depends(current_user), db: Session = Depends(get_db)):
    i = _inv_for(db, user, invoice_id)
    cn = db.execute(select(m.CreditNote).where(m.CreditNote.invoice_id == i.id)).scalar_one_or_none()
    return Response(render_invoice(i, company(db), cn), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{i.invoice_no.replace("/", "-")}.pdf"', "Cache-Control": "no-store"})


@router.get("/invoices/{invoice_id}/share")
def invoice_share(invoice_id: int, user: m.User = Depends(current_user), db: Session = Depends(get_db)):
    """Prefilled WhatsApp / email links. The PDF itself is fetched by the logged-in user and attached or sent from their device."""
    i = _inv_for(db, user, invoice_id)
    co = company(db)
    text = f"{co['name']}: Invoice {i.invoice_no} dated {i.invoice_date:%d-%m-%Y} for Rs {fmt_inr(i.total_paise)}. Thank you for your business."
    phone = "".join(ch for ch in (i.customer.phone or "") if ch.isdigit())
    wa = f"https://wa.me/{('91' + phone[-10:]) if phone else ''}?text={quote(text)}"
    return {"whatsapp_url": wa, "mailto_url": f"mailto:?subject={quote('Invoice ' + i.invoice_no)}&body={quote(text)}", "message": text}


@router.post("/invoices/{invoice_id}/dispatch", status_code=201)
def dispatch_invoice(invoice_id: int, body: s.DispatchIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    i = db.get(m.Invoice, invoice_id)
    if not i:
        raise NotFound("Invoice not found")
    d = svc.dispatch(db, user, i, [l.model_dump() for l in body.lines] if body.lines else None, body.vehicle_no, body.notes)
    db.commit()
    return {"dispatch_no": d.dispatch_no, "invoice_status": i.dispatch_status, "lines": [{"item_id": l.item_id, "qty": l.qty, "batch_no": l.batch_no, "expiry_date": l.expiry_date} for l in d.lines]}


@router.post("/invoices/{invoice_id}/cancel")
def cancel_invoice(invoice_id: int, body: s.CancelIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    i = db.get(m.Invoice, invoice_id)
    if not i:
        raise NotFound("Invoice not found")
    cn = svc.cancel_invoice(db, user, i, body.reason)
    db.commit()
    return {"credit_note_no": cn.cn_no, "stock_returned": cn.stock_returned, "total_paise": cn.total_paise}


# ---------------- payments ----------------
@router.post("/payments", status_code=201)
def create_payment(body: s.PaymentIn, response: Response, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    p, created = pay.record_payment(db, user, body.customer_id, body.amount_paise, body.mode, body.reference, body.invoice_id, body.client_ref, body.payment_date)
    db.commit()
    response.status_code = 201 if created else 200
    return pay.payment_view(p)


@router.get("/payments")
def list_payments(customer_id: int | None = None, limit: int = Query(50), offset: int = Query(0), _: m.User = Depends(VIEWERS), db: Session = Depends(get_db)):
    limit, offset = _page(limit, offset)
    q = select(m.Payment)
    if customer_id:
        q = q.where(m.Payment.customer_id == customer_id)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    return {"total": total, "items": [pay.payment_view(p) for p in db.execute(q.order_by(m.Payment.id.desc()).limit(limit).offset(offset)).scalars()]}


@router.get("/customers/{cid}/account")
def customer_account(cid: int, _: m.User = Depends(VIEWERS), db: Session = Depends(get_db)):
    c = db.get(m.Customer, cid)
    if not c:
        raise NotFound("Customer not found")
    return {"customer": c.name, **pay.customer_balance(db, cid), "open_invoices": [
        {"id": i.id, "invoice_no": i.invoice_no, "date": i.invoice_date, "total_paise": i.total_paise, "outstanding_paise": pay.invoice_outstanding(db, i)} for i in pay.open_invoices(db, cid)]}
