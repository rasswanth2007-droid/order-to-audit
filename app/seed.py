"""Loads the section-5 benchmark master data. Usage: python -m app.seed [--reset]"""
import sys
from datetime import date
from sqlalchemy import select
from sqlalchemy.orm import Session
from . import models as m
from .config import get_settings
from .db import Base, SessionLocal, engine
from .security import hash_password
from .services import inventory as inv, production as prod
from .units import to_base
from .util import DEFAULT_COMPANY, set_setting, today_ist

USERS = [("admin", "Factory Admin", "ADMIN"), ("salesman_a", "Salesman A", "SALESMAN"), ("salesman_b", "Salesman B", "SALESMAN"),
         ("production", "Production Supervisor", "PRODUCTION"), ("accountant", "Accountant / Auditor", "ACCOUNTANT"), ("owner", "Owner", "OWNER")]
# (sku, name, kind, unit, hsn, price, opening qty, opening rate paise per unit, reorder level)
ITEMS = [("FLOUR", "Flour", "RAW", "kg", "1101", None, "100", 4200, "50"),
         ("OIL", "Cooking oil", "RAW", "l", "1512", None, "30", 14000, "15"),
         ("SPICE", "Salt and spice mix", "RAW", "kg", "0910", None, "5", 20000, "2"),
         ("POUCH200", "200 g pouch", "PACKAGING", "pcs", "3923", None, "500", 250, "300"),
         ("CARTON20", "Carton (holds 20 packets)", "PACKAGING", "pcs", "4819", None, "30", 1500, "20")]


def seed(db: Session, password: str, opening_date: date | None = None) -> None:
    if db.execute(select(m.User)).first():
        print("Database already seeded; use --reset to start over")
        return
    od = opening_date or today_ist().replace(day=1)
    set_setting(db, "company", DEFAULT_COMPANY)
    set_setting(db, "variance_tolerance_bp", 300)
    users = {}
    for u, name, role in USERS:
        row = m.User(username=u, full_name=name, role=role, password_hash=hash_password(password))
        db.add(row)
        users[u] = row
    db.flush()
    admin = users["admin"]
    items = {}
    for sku, name, kind, unit, hsn, price, oq, orate, reorder in ITEMS:
        dim = {"kg": "MASS", "l": "VOLUME", "pcs": "COUNT"}[unit]
        it = m.Item(sku=sku, name=name, kind=kind, dimension=dim, display_unit=unit, hsn_code=hsn, gst_rate_bp=0 if kind != "FINISHED" else 500)
        db.add(it); db.flush()
        it.reorder_level_base = to_base(it, reorder, unit)
        q = to_base(it, oq, unit)
        inv.post(db, it, "OPENING", q, od, "opening", None, admin.id, value_delta=q * orate // {"kg": 1000, "l": 1000, "pcs": 1}[unit], narration="Opening balance")
        items[sku] = it
    fg = m.Item(sku="MUR200", name="Murukku 200 g", kind="FINISHED", dimension="COUNT", display_unit="packet", hsn_code="21069099", gst_rate_bp=500,
                selling_price_paise=5000, packets_per_carton=20, shelf_life_days=90, reorder_level_base=0)
    db.add(fg); db.flush()
    # Assumption (documented in README): opening finished goods valued at Rs 30.00 per packet; lot name OPENING, no expiry known.
    inv.post(db, fg, "OPENING", 50, od, "opening", None, admin.id, value_delta=50 * 3000, batch_no="OPENING", narration="Opening balance (assumed value Rs 30/packet)")
    items["MUR200"] = fg
    prod.save_bom(db, admin, fg.id, 200, [{"item_id": items["FLOUR"].id, "qty": "40", "unit": "kg"}, {"item_id": items["OIL"].id, "qty": "10", "unit": "l"},
                                          {"item_id": items["SPICE"].id, "qty": "1.2", "unit": "kg"}, {"item_id": items["POUCH200"].id, "qty": "200", "unit": "pcs"},
                                          {"item_id": items["CARTON20"].id, "qty": "10", "unit": "pcs"}])
    db.add_all([m.Customer(name="Retailer A", type="RETAILER", gstin="33AAACR1234A1Z5", state_code="33", address="45 Main Bazaar, Tiruchirappalli, Tamil Nadu", phone="9876500001", credit_days=15, salesman_id=users["salesman_a"].id),
                m.Customer(name="Distributor B", type="DISTRIBUTOR", gstin="29AAACD5678B1Z2", state_code="29", address="8 Market Road, Bengaluru, Karnataka", phone="9876500002", credit_days=30, salesman_id=users["salesman_b"].id),
                m.Supplier(name="Sri Lakshmi Flour Mills", gstin="33AAACS1111C1Z1", state_code="33", phone="9876500010"),
                m.Supplier(name="Annai Oil Traders", gstin="33AAACA2222D1Z3", state_code="33", phone="9876500011")])
    db.commit()
    print(f"Seeded. Demo logins (password from SEED_DEMO_PASSWORD): {', '.join(u for u, _, _ in USERS)}")


if __name__ == "__main__":
    s = get_settings()
    if s.is_prod and s.seed_demo_password == "Demo@12345":
        sys.exit("Refusing to seed production with the default demo password; set SEED_DEMO_PASSWORD")
    if "--reset" in sys.argv:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db, s.seed_demo_password)
