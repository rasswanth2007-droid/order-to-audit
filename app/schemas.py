from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Qty = Decimal


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LoginIn(Strict):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=128)


class PasswordChange(Strict):
    current_password: str
    new_password: str = Field(min_length=10, max_length=128)


class UserCreate(Strict):
    username: str = Field(min_length=3, max_length=60, pattern=r"^[A-Za-z0-9_.-]+$")
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=10, max_length=128)
    role: Literal["ADMIN", "SALESMAN", "PRODUCTION", "ACCOUNTANT", "OWNER"]


class UserUpdate(Strict):
    full_name: str | None = Field(None, max_length=120)
    role: Literal["ADMIN", "SALESMAN", "PRODUCTION", "ACCOUNTANT", "OWNER"] | None = None
    is_active: bool | None = None
    new_password: str | None = Field(None, min_length=10, max_length=128)


class ItemIn(Strict):
    sku: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["RAW", "PACKAGING", "FINISHED"]
    display_unit: Literal["kg", "g", "l", "ml", "pcs", "packet"]
    hsn_code: str | None = Field(None, max_length=10)
    gst_rate_bp: int = Field(500, ge=0, le=4000)
    selling_price_paise: int | None = Field(None, ge=0)
    packets_per_carton: int | None = Field(None, gt=0)
    shelf_life_days: int | None = Field(None, gt=0)
    reorder_level: Decimal = Field(Decimal(0), ge=0)


class ItemUpdate(Strict):
    name: str | None = Field(None, max_length=120)
    hsn_code: str | None = None
    gst_rate_bp: int | None = Field(None, ge=0, le=4000)
    selling_price_paise: int | None = Field(None, ge=0)
    packets_per_carton: int | None = Field(None, gt=0)
    shelf_life_days: int | None = Field(None, gt=0)
    reorder_level: Decimal | None = Field(None, ge=0)
    is_active: bool | None = None


class CustomerIn(Strict):
    name: str = Field(min_length=1, max_length=160)
    type: Literal["RETAILER", "DISTRIBUTOR"]
    gstin: str | None = Field(None, pattern=r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
    state_code: str = Field(pattern=r"^[0-9]{2}$")
    address: str | None = Field(None, max_length=500)
    phone: str | None = Field(None, max_length=20)
    credit_days: int = Field(15, ge=0, le=365)
    salesman_id: int | None = None
    is_active: bool = True


class CustomerPriceIn(Strict):
    item_id: int
    price_paise: int = Field(ge=0)


class SupplierIn(Strict):
    name: str = Field(min_length=1, max_length=160)
    gstin: str | None = Field(None, max_length=15)
    state_code: str | None = Field(None, pattern=r"^[0-9]{2}$")
    phone: str | None = Field(None, max_length=20)
    address: str | None = Field(None, max_length=500)
    is_active: bool = True


class BomLineIn(Strict):
    item_id: int
    qty: Qty = Field(gt=0)
    unit: str


class BomIn(Strict):
    yield_qty: int = Field(gt=0, description="Packets per batch")
    lines: list[BomLineIn] = Field(min_length=1, max_length=40)


class QtyLine(Strict):
    item_id: int
    qty: Qty = Field(gt=0)
    unit: str


class WasteLine(QtyLine):
    reason: str | None = Field(None, max_length=120)


class OrderLineIn(Strict):
    item_id: int
    qty: Qty = Field(gt=0)
    unit: str = "packet"


class OrderIn(Strict):
    customer_id: int
    client_ref: str = Field(min_length=8, max_length=60, description="UUID generated on the phone; makes retries/offline sync idempotent")
    lines: list[OrderLineIn] = Field(min_length=1, max_length=50)
    notes: str | None = Field(None, max_length=255)
    taken_at: datetime | None = None


class OrderSync(Strict):
    orders: list[OrderIn] = Field(min_length=1, max_length=50)


class OrderEditLine(Strict):
    item_id: int
    qty: Qty = Field(gt=0)
    unit: str = "packet"
    price_paise: int | None = Field(None, ge=0)


class OrderEdit(Strict):
    lines: list[OrderEditLine] = Field(min_length=1, max_length=50)


class ApproveIn(Strict):
    accept_shortage: bool = False
    raise_invoice: bool = False


class RejectIn(Strict):
    reason: str = Field(min_length=3, max_length=255)


class DispatchLineIn(Strict):
    invoice_line_id: int
    qty: int = Field(gt=0)


class DispatchIn(Strict):
    lines: list[DispatchLineIn] | None = None
    vehicle_no: str | None = Field(None, max_length=20)
    notes: str | None = Field(None, max_length=255)


class CancelIn(Strict):
    reason: str = Field(min_length=3, max_length=255)


class PaymentIn(Strict):
    customer_id: int
    amount_paise: int = Field(gt=0)
    mode: Literal["CASH", "UPI", "BANK", "CHEQUE"]
    reference: str | None = Field(None, max_length=60)
    invoice_id: int | None = None
    client_ref: str | None = Field(None, min_length=8, max_length=60)
    payment_date: date | None = None


class PurchaseLineIn(Strict):
    item_id: int
    qty: Qty = Field(gt=0)
    unit: str
    rate_paise: int = Field(ge=0, description="Rate per `unit`, excl. GST")
    gst_rate_bp: int = Field(0, ge=0, le=4000)


class PurchaseIn(Strict):
    supplier_id: int
    supplier_invoice_no: str | None = Field(None, max_length=40)
    purchase_date: date | None = None
    client_ref: str | None = Field(None, min_length=8, max_length=60)
    lines: list[PurchaseLineIn] = Field(min_length=1, max_length=50)


class RunIn(Strict):
    product_id: int
    planned_date: date | None = None
    batches: Decimal | None = Field(None, gt=0, le=1000)
    basis_item_id: int | None = None
    basis_qty: Qty | None = Field(None, gt=0)
    basis_unit: str | None = None
    notes: str | None = Field(None, max_length=255)


class IssueIn(Strict):
    lines: list[QtyLine] = Field(min_length=1, max_length=40)
    issue_date: date | None = None


class CompleteIn(Strict):
    good_output: int = Field(gt=0)
    rejected_output: int = Field(0, ge=0)
    packaging_used: list[QtyLine] = []
    wastage: list[WasteLine] = []
    mfg_date: date | None = None


class OverheadIn(Strict):
    category: Literal["LABOUR", "GAS_POWER", "OTHER"]
    amount_paise: int = Field(gt=0)
    note: str | None = Field(None, max_length=255)


class MonthlyOverheadIn(Strict):
    month: str = Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    category: str = Field(min_length=1, max_length=30)
    amount_paise: int = Field(gt=0)
    note: str | None = Field(None, max_length=255)


class AdjustmentIn(Strict):
    item_id: int
    qty: Decimal  # positive = gain, negative = loss
    unit: str
    reason: str = Field(min_length=3, max_length=200)
    batch_no: str | None = Field(None, max_length=40)
    value_paise: int | None = Field(None, ge=0, description="Required for gains: value of stock added")


class SettingsIn(Strict):
    variance_tolerance_pct: Decimal | None = Field(None, ge=0, le=100)
    company: dict | None = None


class VisitIn(Strict):
    customer_id: int
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    accuracy_m: float | None = Field(None, ge=0)
    notes: str | None = Field(None, max_length=255)


class SchemeIn(Strict):
    name: str = Field(min_length=2, max_length=120)
    item_id: int
    min_qty: int = Field(1, gt=0)
    discount_pct: Decimal = Field(Decimal(0), ge=0, le=50)
    is_active: bool = True


class ReturnLineIn(Strict):
    invoice_line_id: int
    qty: int = Field(gt=0)


class ReturnIn(Strict):
    lines: list[ReturnLineIn] = Field(min_length=1, max_length=50)
    reason: str = Field(min_length=3, max_length=255)
