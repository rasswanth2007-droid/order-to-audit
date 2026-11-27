from __future__ import annotations
from datetime import date, datetime, timezone
from sqlalchemy import (BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, String, Text,
                        UniqueConstraint, event)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base
from .errors import ImmutableRecord

ROLES = ("ADMIN", "SALESMAN", "PRODUCTION", "ACCOUNTANT", "OWNER")
BigInt = BigInteger().with_variant(Integer, "sqlite")  # SQLite needs INTEGER PK for autoincrement


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (CheckConstraint("role IN ('ADMIN','SALESMAN','PRODUCTION','ACCOUNTANT','OWNER')", name="ck_user_role"),)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class NumberSeries(Base):
    __tablename__ = "number_series"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    name: Mapped[str] = mapped_column(String(20))
    fy: Mapped[str] = mapped_column(String(10))
    next_no: Mapped[int] = mapped_column(Integer, default=1)
    __table_args__ = (UniqueConstraint("name", "fy", name="uq_series"),)


class Item(Base):
    """Raw material, packaging material or finished product (one table, `kind` tells which)."""
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    sku: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(12))
    dimension: Mapped[str] = mapped_column(String(8))
    display_unit: Mapped[str] = mapped_column(String(8))
    hsn_code: Mapped[str | None] = mapped_column(String(10))
    gst_rate_bp: Mapped[int] = mapped_column(Integer, default=500)
    selling_price_paise: Mapped[int | None] = mapped_column(BigInt)  # finished goods default price-list price
    packets_per_carton: Mapped[int | None] = mapped_column(Integer)
    shelf_life_days: Mapped[int | None] = mapped_column(Integer)
    reorder_level_base: Mapped[int] = mapped_column(BigInt, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (
        CheckConstraint("kind IN ('RAW','PACKAGING','FINISHED')", name="ck_item_kind"),
        CheckConstraint("dimension IN ('MASS','VOLUME','COUNT')", name="ck_item_dim"),
        CheckConstraint("gst_rate_bp BETWEEN 0 AND 4000", name="ck_item_gst"),
        CheckConstraint("reorder_level_base >= 0", name="ck_item_reorder"),
    )


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    type: Mapped[str] = mapped_column(String(12))
    gstin: Mapped[str | None] = mapped_column(String(15))
    state_code: Mapped[str] = mapped_column(String(2))
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(20))
    credit_days: Mapped[int] = mapped_column(Integer, default=15)
    salesman_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    __table_args__ = (CheckConstraint("type IN ('RETAILER','DISTRIBUTOR')", name="ck_cust_type"),)


class CustomerPrice(Base):
    __tablename__ = "customer_prices"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    price_paise: Mapped[int] = mapped_column(BigInt)
    __table_args__ = (UniqueConstraint("customer_id", "item_id", name="uq_cust_price"), CheckConstraint("price_paise >= 0", name="ck_cp"))


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    gstin: Mapped[str | None] = mapped_column(String(15))
    state_code: Mapped[str | None] = mapped_column(String(2))
    phone: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Bom(Base):
    __tablename__ = "boms"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("items.id"), unique=True)
    yield_qty: Mapped[int] = mapped_column(Integer)  # packets per batch
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    lines: Mapped[list["BomLine"]] = relationship(cascade="all, delete-orphan", order_by="BomLine.id")
    product: Mapped[Item] = relationship()
    __table_args__ = (CheckConstraint("yield_qty > 0", name="ck_bom_yield"),)


class BomLine(Base):
    __tablename__ = "bom_lines"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    bom_id: Mapped[int] = mapped_column(ForeignKey("boms.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty_base: Mapped[int] = mapped_column(BigInt)  # per batch, in base units
    item: Mapped[Item] = relationship()
    __table_args__ = (UniqueConstraint("bom_id", "item_id", name="uq_bom_item"), CheckConstraint("qty_base > 0", name="ck_bomline_qty"))


class Purchase(Base):
    __tablename__ = "purchases"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    purchase_no: Mapped[str] = mapped_column(String(30), unique=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"))
    supplier_invoice_no: Mapped[str | None] = mapped_column(String(40))
    purchase_date: Mapped[date] = mapped_column(Date)
    taxable_paise: Mapped[int] = mapped_column(BigInt, default=0)
    tax_paise: Mapped[int] = mapped_column(BigInt, default=0)
    total_paise: Mapped[int] = mapped_column(BigInt, default=0)
    client_ref: Mapped[str | None] = mapped_column(String(60), unique=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    lines: Mapped[list["PurchaseLine"]] = relationship(cascade="all, delete-orphan")
    supplier: Mapped[Supplier] = relationship()


class PurchaseLine(Base):
    __tablename__ = "purchase_lines"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    purchase_id: Mapped[int] = mapped_column(ForeignKey("purchases.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty_base: Mapped[int] = mapped_column(BigInt)
    rate_paise: Mapped[int] = mapped_column(BigInt)  # per `rate_unit`
    rate_unit: Mapped[str] = mapped_column(String(8))
    value_paise: Mapped[int] = mapped_column(BigInt)
    gst_rate_bp: Mapped[int] = mapped_column(Integer, default=0)
    tax_paise: Mapped[int] = mapped_column(BigInt, default=0)
    item: Mapped[Item] = relationship()
    __table_args__ = (CheckConstraint("qty_base > 0", name="ck_pl_qty"), CheckConstraint("rate_paise >= 0", name="ck_pl_rate"))


class StockLedger(Base):
    """Append-only. Balances are ALWAYS SUMs over this table; nobody overwrites a balance."""
    __tablename__ = "stock_ledger"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    entry_date: Mapped[date] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    movement_type: Mapped[str] = mapped_column(String(24))
    qty_delta: Mapped[int] = mapped_column(BigInt)
    value_delta_paise: Mapped[int] = mapped_column(BigInt)
    batch_no: Mapped[str | None] = mapped_column(String(40))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    source_type: Mapped[str] = mapped_column(String(24))
    source_id: Mapped[int | None] = mapped_column(BigInt)
    narration: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    item: Mapped[Item] = relationship()
    __table_args__ = (
        Index("ix_ledger_item", "item_id", "entry_date"),
        Index("ix_ledger_source", "source_type", "source_id"),
        CheckConstraint("movement_type IN ('OPENING','PURCHASE','PRODUCTION_ISSUE','PRODUCTION_WASTE','PRODUCTION_OUTPUT',"
                        "'SALE_DISPATCH','SALE_RETURN','ADJUSTMENT','COST_ADJUSTMENT')", name="ck_ledger_type"),
    )


class ProductionRun(Base):
    __tablename__ = "production_runs"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    run_no: Mapped[str] = mapped_column(String(30), unique=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    bom_version: Mapped[int] = mapped_column(Integer)
    batches_milli: Mapped[int] = mapped_column(Integer)  # 1000 = one standard batch
    planned_output: Mapped[int] = mapped_column(Integer)
    good_output: Mapped[int | None] = mapped_column(Integer)
    rejected_output: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="PLANNED")
    planned_date: Mapped[date] = mapped_column(Date)
    mfg_date: Mapped[date | None] = mapped_column(Date)
    batch_no: Mapped[str | None] = mapped_column(String(40))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    product: Mapped[Item] = relationship()
    plan_lines: Mapped[list["RunPlanLine"]] = relationship(cascade="all, delete-orphan")
    overheads: Mapped[list["RunOverhead"]] = relationship(cascade="all, delete-orphan")
    __table_args__ = (CheckConstraint("status IN ('PLANNED','ISSUED','COMPLETED')", name="ck_run_status"),
                      CheckConstraint("batches_milli > 0", name="ck_run_batches"))


class RunPlanLine(Base):
    __tablename__ = "run_plan_lines"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("production_runs.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    planned_base: Mapped[int] = mapped_column(BigInt)
    item: Mapped[Item] = relationship()


class RunOverhead(Base):
    __tablename__ = "run_overheads"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("production_runs.id"))
    category: Mapped[str] = mapped_column(String(20))
    amount_paise: Mapped[int] = mapped_column(BigInt)
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (CheckConstraint("amount_paise > 0", name="ck_ovh_amt"),)


class MonthlyOverhead(Base):
    __tablename__ = "monthly_overheads"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    month: Mapped[str] = mapped_column(String(7))  # YYYY-MM
    category: Mapped[str] = mapped_column(String(30))
    amount_paise: Mapped[int] = mapped_column(BigInt)
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    __table_args__ = (CheckConstraint("amount_paise > 0", name="ck_mo_amt"),)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    order_no: Mapped[str] = mapped_column(String(30), unique=True)
    client_ref: Mapped[str] = mapped_column(String(60), unique=True)  # idempotency key from the phone
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    salesman_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(12), default="SUBMITTED")
    notes: Mapped[str | None] = mapped_column(String(255))
    rejection_reason: Mapped[str | None] = mapped_column(String(255))
    taken_at: Mapped[datetime | None] = mapped_column(DateTime)  # client timestamp (offline orders)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    customer: Mapped[Customer] = relationship()
    salesman: Mapped[User] = relationship()
    lines: Mapped[list["OrderLine"]] = relationship(cascade="all, delete-orphan", order_by="OrderLine.id")
    __table_args__ = (CheckConstraint("status IN ('SUBMITTED','APPROVED','REJECTED','INVOICED','DISPATCHED','CANCELLED')", name="ck_order_status"),)


class OrderLine(Base):
    __tablename__ = "order_lines"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[int] = mapped_column(Integer)  # packets
    price_paise: Mapped[int] = mapped_column(BigInt)
    orig_qty: Mapped[int] = mapped_column(Integer)
    orig_price_paise: Mapped[int] = mapped_column(BigInt)
    item: Mapped[Item] = relationship()
    __table_args__ = (CheckConstraint("qty > 0", name="ck_ol_qty"), UniqueConstraint("order_id", "item_id", name="uq_ol_item"))


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    invoice_no: Mapped[str] = mapped_column(String(30), unique=True)
    fy: Mapped[str] = mapped_column(String(10))
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id"), unique=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    invoice_date: Mapped[date] = mapped_column(Date)
    supply_type: Mapped[str] = mapped_column(String(5))  # INTRA / INTER
    place_of_supply: Mapped[str] = mapped_column(String(2))
    buyer_name: Mapped[str] = mapped_column(String(160))
    buyer_gstin: Mapped[str | None] = mapped_column(String(15))
    buyer_address: Mapped[str | None] = mapped_column(Text)
    taxable_paise: Mapped[int] = mapped_column(BigInt)
    cgst_paise: Mapped[int] = mapped_column(BigInt, default=0)
    sgst_paise: Mapped[int] = mapped_column(BigInt, default=0)
    igst_paise: Mapped[int] = mapped_column(BigInt, default=0)
    round_off_paise: Mapped[int] = mapped_column(BigInt, default=0)
    total_paise: Mapped[int] = mapped_column(BigInt)
    status: Mapped[str] = mapped_column(String(10), default="ISSUED")
    dispatch_status: Mapped[str] = mapped_column(String(8), default="NONE")
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancel_reason: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    customer: Mapped[Customer] = relationship()
    order: Mapped[Order] = relationship()
    lines: Mapped[list["InvoiceLine"]] = relationship(cascade="all, delete-orphan", order_by="InvoiceLine.id")
    __table_args__ = (CheckConstraint("status IN ('ISSUED','CANCELLED')", name="ck_inv_status"),
                      CheckConstraint("dispatch_status IN ('NONE','PARTIAL','FULL')", name="ck_inv_disp"),
                      CheckConstraint("supply_type IN ('INTRA','INTER')", name="ck_inv_supply"))


class InvoiceLine(Base):
    __tablename__ = "invoice_lines"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    description: Mapped[str] = mapped_column(String(160))
    hsn_code: Mapped[str | None] = mapped_column(String(10))
    qty: Mapped[int] = mapped_column(Integer)
    price_paise: Mapped[int] = mapped_column(BigInt)
    taxable_paise: Mapped[int] = mapped_column(BigInt)
    gst_rate_bp: Mapped[int] = mapped_column(Integer)
    cgst_paise: Mapped[int] = mapped_column(BigInt, default=0)
    sgst_paise: Mapped[int] = mapped_column(BigInt, default=0)
    igst_paise: Mapped[int] = mapped_column(BigInt, default=0)
    dispatched_qty: Mapped[int] = mapped_column(Integer, default=0)
    item: Mapped[Item] = relationship()
    __table_args__ = (CheckConstraint("dispatched_qty >= 0 AND dispatched_qty <= qty", name="ck_il_disp"),)


class Dispatch(Base):
    __tablename__ = "dispatches"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    dispatch_no: Mapped[str] = mapped_column(String(30), unique=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"))
    dispatch_date: Mapped[date] = mapped_column(Date)
    vehicle_no: Mapped[str | None] = mapped_column(String(20))
    notes: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    lines: Mapped[list["DispatchLine"]] = relationship(cascade="all, delete-orphan")


class DispatchLine(Base):
    __tablename__ = "dispatch_lines"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    dispatch_id: Mapped[int] = mapped_column(ForeignKey("dispatches.id"))
    invoice_line_id: Mapped[int] = mapped_column(ForeignKey("invoice_lines.id"))
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id"))
    qty: Mapped[int] = mapped_column(Integer)
    batch_no: Mapped[str | None] = mapped_column(String(40))
    expiry_date: Mapped[date | None] = mapped_column(Date)
    value_paise: Mapped[int] = mapped_column(BigInt)  # stock value relieved (COGS at dispatch)


class CreditNote(Base):
    __tablename__ = "credit_notes"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    cn_no: Mapped[str] = mapped_column(String(30), unique=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), unique=True)
    cn_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(String(255))
    taxable_paise: Mapped[int] = mapped_column(BigInt)
    cgst_paise: Mapped[int] = mapped_column(BigInt)
    sgst_paise: Mapped[int] = mapped_column(BigInt)
    igst_paise: Mapped[int] = mapped_column(BigInt)
    round_off_paise: Mapped[int] = mapped_column(BigInt)
    total_paise: Mapped[int] = mapped_column(BigInt)
    stock_returned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    invoice: Mapped[Invoice] = relationship()


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    receipt_no: Mapped[str] = mapped_column(String(30), unique=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"))
    payment_date: Mapped[date] = mapped_column(Date)
    amount_paise: Mapped[int] = mapped_column(BigInt)
    mode: Mapped[str] = mapped_column(String(10))
    reference: Mapped[str | None] = mapped_column(String(60))
    client_ref: Mapped[str | None] = mapped_column(String(60), unique=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    customer: Mapped[Customer] = relationship()
    allocations: Mapped[list["PaymentAllocation"]] = relationship(cascade="all, delete-orphan")
    __table_args__ = (CheckConstraint("amount_paise > 0", name="ck_pay_amt"),
                      CheckConstraint("mode IN ('CASH','UPI','BANK','CHEQUE')", name="ck_pay_mode"))


class PaymentAllocation(Base):
    __tablename__ = "payment_allocations"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id"))
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"))
    amount_paise: Mapped[int] = mapped_column(BigInt)
    __table_args__ = (CheckConstraint("amount_paise > 0", name="ck_pa_amt"),)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInt, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    user_id: Mapped[int | None] = mapped_column(BigInt)
    username: Mapped[str | None] = mapped_column(String(60))
    action: Mapped[str] = mapped_column(String(40))
    entity: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[str | None] = mapped_column(String(40))
    before_json: Mapped[str | None] = mapped_column(Text)
    after_json: Mapped[str | None] = mapped_column(Text)
    ip: Mapped[str | None] = mapped_column(String(45))
    __table_args__ = (Index("ix_audit_entity", "entity", "entity_id"),)


def _immutable(*_a, **_k):
    raise ImmutableRecord("This table is append-only")


for _model in (StockLedger, AuditLog):
    event.listen(_model, "before_update", _immutable)
    event.listen(_model, "before_delete", _immutable)
