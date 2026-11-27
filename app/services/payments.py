from datetime import date
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from .. import models as m
from ..audit import audit
from ..errors import Conflict, NotFound, ValidationFailed
from ..util import fy_of, next_number, today_ist


def invoice_outstanding(db: Session, invoice: m.Invoice) -> int:
    if invoice.status != "ISSUED":
        return 0
    paid = db.execute(select(func.coalesce(func.sum(m.PaymentAllocation.amount_paise), 0)).where(m.PaymentAllocation.invoice_id == invoice.id)).scalar_one()
    return invoice.total_paise - int(paid)


def customer_balance(db: Session, customer_id: int) -> dict:
    billed = db.execute(select(func.coalesce(func.sum(m.Invoice.total_paise), 0)).where(m.Invoice.customer_id == customer_id, m.Invoice.status == "ISSUED")).scalar_one()
    paid = db.execute(select(func.coalesce(func.sum(m.Payment.amount_paise), 0)).where(m.Payment.customer_id == customer_id)).scalar_one()
    return {"billed_paise": int(billed), "received_paise": int(paid), "outstanding_paise": int(billed) - int(paid)}


def open_invoices(db: Session, customer_id: int) -> list[m.Invoice]:
    invs = db.execute(select(m.Invoice).where(m.Invoice.customer_id == customer_id, m.Invoice.status == "ISSUED").order_by(m.Invoice.invoice_date, m.Invoice.id)).scalars().all()
    return [i for i in invs if invoice_outstanding(db, i) > 0]


def record_payment(db: Session, user, customer_id: int, amount_paise: int, mode: str, reference: str | None, invoice_id: int | None,
                   client_ref: str | None, payment_date: date | None) -> tuple[m.Payment, bool]:
    if client_ref:
        ex = db.execute(select(m.Payment).where(m.Payment.client_ref == client_ref)).scalar_one_or_none()
        if ex:
            return ex, False
    if amount_paise <= 0:
        raise ValidationFailed("Amount must be positive")
    cust = db.get(m.Customer, customer_id)
    if not cust:
        raise NotFound("Customer not found")
    today = payment_date or today_ist()
    fy = fy_of(today)
    pay = m.Payment(receipt_no=f"RCT/{fy}/{next_number(db, 'RCT', fy):04d}", customer_id=customer_id, payment_date=today, amount_paise=amount_paise,
                    mode=mode, reference=reference, client_ref=client_ref, created_by=user.id)
    db.add(pay)
    db.flush()
    left = amount_paise
    targets = open_invoices(db, customer_id)
    if invoice_id is not None:  # named invoice first, then oldest-first for any excess
        named = next((i for i in targets if i.id == invoice_id), None)
        if not named:
            raise Conflict("Invoice is not an open invoice of this customer")
        targets = [named] + [i for i in targets if i.id != invoice_id]
    for inv in targets:
        if left == 0:
            break
        take = min(left, invoice_outstanding(db, inv))
        pay.allocations.append(m.PaymentAllocation(invoice_id=inv.id, amount_paise=take))
        db.flush()
        left -= take
    audit(db, user, "PAYMENT", "payment", pay.id, None, {"receipt_no": pay.receipt_no, "amount_paise": amount_paise, "unallocated_paise": left})
    return pay, True


def payment_view(p: m.Payment) -> dict:
    alloc = sum(a.amount_paise for a in p.allocations)
    return {"id": p.id, "receipt_no": p.receipt_no, "customer_id": p.customer_id, "customer": p.customer.name, "payment_date": p.payment_date,
            "amount_paise": p.amount_paise, "mode": p.mode, "reference": p.reference, "unallocated_paise": p.amount_paise - alloc,
            "allocations": [{"invoice_id": a.invoice_id, "amount_paise": a.amount_paise} for a in p.allocations]}
