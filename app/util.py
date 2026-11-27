import json
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m

IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_COMPANY = {
    "name": "Sri Murugan Snacks (Demo)", "gstin": "33ABCDE1234F1Z5", "state_code": "33", "state_name": "Tamil Nadu",
    "address": "12, Industrial Estate, Tiruchirappalli, Tamil Nadu 620001", "phone": "0431-0000000",
    "email": "accounts@example.com", "invoice_prefix": "INV", "bank": "Demo Bank, A/c XXXX0000, IFSC DEMO0000001",
}
STATE_NAMES = {"29": "Karnataka", "33": "Tamil Nadu", "32": "Kerala", "36": "Telangana", "37": "Andhra Pradesh",
               "27": "Maharashtra", "07": "Delhi", "24": "Gujarat", "19": "West Bengal", "09": "Uttar Pradesh"}


def today_ist() -> date:
    return datetime.now(IST).date()


def fy_of(d: date) -> str:
    y = d.year if d.month >= 4 else d.year - 1
    return f"{y}-{str(y + 1)[2:]}"


def get_setting(db: Session, key: str, default=None):
    row = db.get(m.Setting, key)
    return json.loads(row.value) if row else default


def set_setting(db: Session, key: str, value) -> None:
    row = db.get(m.Setting, key)
    if row:
        row.value = json.dumps(value)
    else:
        db.add(m.Setting(key=key, value=json.dumps(value)))


def company(db: Session) -> dict:
    return {**DEFAULT_COMPANY, **(get_setting(db, "company", {}) or {})}


def tolerance_bp(db: Session) -> int:
    return int(get_setting(db, "variance_tolerance_bp", 300))


def next_number(db: Session, name: str, fy: str) -> int:
    """Gap-free per-financial-year counter; row is locked (Postgres) / write-locked (SQLite) inside the txn."""
    row = db.execute(select(m.NumberSeries).where(m.NumberSeries.name == name, m.NumberSeries.fy == fy).with_for_update()).scalar_one_or_none()
    if row is None:
        row = m.NumberSeries(name=name, fy=fy, next_no=1)
        db.add(row)
        db.flush()
    n = row.next_no
    row.next_no = n + 1
    return n


def month_range(month: str) -> tuple[date, date]:
    y, mo = int(month[:4]), int(month[5:7])
    start = date(y, mo, 1)
    end = date(y + (mo == 12), (mo % 12) + 1, 1) - timedelta(days=1)
    return start, end
