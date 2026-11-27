"""Populate rich realistic sample records across all workflows using real domain services.
Usage: python -m app.seed_demo
"""
from datetime import timedelta
from decimal import Decimal
from sqlalchemy import select
from . import models as m
from .config import get_settings
from .db import Base, SessionLocal, engine
from .seed import seed
from .services import inventory as inv, payments as pay, production as prod, sales as svc
from .units import to_base
from .util import fy_of, next_number, today_ist


def run_demo_seed() -> None:
    s = get_settings()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    with SessionLocal() as db:
        today = today_ist()
        month_start = today.replace(day=1)
        seed(db, s.seed_demo_password, opening_date=month_start)

        admin = db.execute(select(m.User).where(m.User.username == "admin")).scalar_one()
        sales_a = db.execute(select(m.User).where(m.User.username == "salesman_a")).scalar_one()
        sales_b = db.execute(select(m.User).where(m.User.username == "salesman_b")).scalar_one()
        prod_user = db.execute(select(m.User).where(m.User.username == "production")).scalar_one()

        flour = db.execute(select(m.Item).where(m.Item.sku == "FLOUR")).scalar_one()
        oil = db.execute(select(m.Item).where(m.Item.sku == "OIL")).scalar_one()
        spice = db.execute(select(m.Item).where(m.Item.sku == "SPICE")).scalar_one()
        pouch = db.execute(select(m.Item).where(m.Item.sku == "POUCH200")).scalar_one()
        carton = db.execute(select(m.Item).where(m.Item.sku == "CARTON20")).scalar_one()
        murukku = db.execute(select(m.Item).where(m.Item.sku == "MUR200")).scalar_one()

        # Additional finished products & BOMs
        ribbon = m.Item(
            sku="RIB200",
            name="Ribbon Pakoda 200 g",
            kind="FINISHED",
            dimension="COUNT",
            display_unit="packet",
            hsn_code="21069099",
            gst_rate_bp=500,
            selling_price_paise=7500,
            packets_per_carton=20,
            shelf_life_days=90,
            reorder_level_base=40,
        )
        mixture = m.Item(
            sku="MIX250",
            name="Madras Mixture 250 g",
            kind="FINISHED",
            dimension="COUNT",
            display_unit="packet",
            hsn_code="21069099",
            gst_rate_bp=500,
            selling_price_paise=8000,
            packets_per_carton=20,
            shelf_life_days=60,
            reorder_level_base=40,
        )
        db.add_all([ribbon, mixture])
        db.flush()

        inv.post(db, ribbon, "OPENING", 120, month_start, "opening", None, admin.id, value_delta=120 * 3600, batch_no="OPENING", narration="Opening balance")
        inv.post(db, mixture, "OPENING", 90, month_start, "opening", None, admin.id, value_delta=90 * 4200, batch_no="OPENING", narration="Opening balance")

        prod.save_bom(db, admin, ribbon.id, 150, [
            {"item_id": flour.id, "qty": "35", "unit": "kg"},
            {"item_id": oil.id, "qty": "9", "unit": "l"},
            {"item_id": spice.id, "qty": "1.5", "unit": "kg"},
            {"item_id": pouch.id, "qty": "150", "unit": "pcs"},
            {"item_id": carton.id, "qty": "8", "unit": "pcs"},
        ])
        prod.save_bom(db, admin, mixture.id, 160, [
            {"item_id": flour.id, "qty": "32", "unit": "kg"},
            {"item_id": oil.id, "qty": "11", "unit": "l"},
            {"item_id": spice.id, "qty": "2.0", "unit": "kg"},
            {"item_id": pouch.id, "qty": "160", "unit": "pcs"},
            {"item_id": carton.id, "qty": "8", "unit": "pcs"},
        ])

        # Additional customers
        cust_a = db.execute(select(m.Customer).where(m.Customer.name == "Retailer A")).scalar_one()
        cust_b = db.execute(select(m.Customer).where(m.Customer.name == "Distributor B")).scalar_one()
        cust_c = m.Customer(
            name="Sri Lakshmi Stores",
            type="RETAILER",
            gstin="34AAACL9999E1Z1",
            state_code="34",
            address="12 Beach Road, Puducherry",
            phone="9876500003",
            credit_days=15,
            salesman_id=sales_a.id,
        )
        cust_d = m.Customer(
            name="Anand Supermarket",
            type="RETAILER",
            gstin="33AAACA8888F1Z9",
            state_code="33",
            address="204 Anna Salai, Chennai, Tamil Nadu",
            phone="9876500004",
            credit_days=30,
            salesman_id=sales_a.id,
        )
        cust_e = m.Customer(
            name="Sakthi Mini Mart",
            type="RETAILER",
            gstin=None,
            state_code="33",
            address="19 Temple Street, Madurai, Tamil Nadu",
            phone="9876500005",
            credit_days=15,
            salesman_id=sales_b.id,
        )
        db.add_all([cust_c, cust_d, cust_e])
        db.flush()

        # Special customer price for Distributor B
        db.add(m.CustomerPrice(customer_id=cust_b.id, item_id=murukku.id, price_paise=4600))

        # Purchases (raw materials + packaging)
        sup_flour = db.execute(select(m.Supplier).where(m.Supplier.name == "Sri Lakshmi Flour Mills")).scalar_one()
        sup_oil = db.execute(select(m.Supplier).where(m.Supplier.name == "Annai Oil Traders")).scalar_one()

        def add_purchase(sup, inv_no, p_date, lines):
            fy = fy_of(p_date)
            p = m.Purchase(
                purchase_no=f"PUR/{fy}/{next_number(db, 'PUR', fy):04d}",
                supplier_id=sup.id,
                supplier_invoice_no=inv_no,
                purchase_date=p_date,
                created_by=admin.id,
            )
            taxable = tax = 0
            for item, qty, unit, rate_paise, gst_bp in lines:
                base = to_base(item, qty, unit)
                val = base * rate_paise // (1000 if unit in ("kg", "l") else 1)
                t = val * gst_bp // 10000
                p.lines.append(m.PurchaseLine(
                    item_id=item.id, qty_base=base, rate_paise=rate_paise,
                    rate_unit=unit, value_paise=val, gst_rate_bp=gst_bp, tax_paise=t
                ))
                taxable += val
                tax += t
            p.taxable_paise, p.tax_paise, p.total_paise = taxable, tax, taxable + tax
            db.add(p)
            db.flush()
            for l in p.lines:
                inv.post(db, l.item, "PURCHASE", l.qty_base, p_date, "purchase", p.id, admin.id, value_delta=l.value_paise, narration=sup.name)

        add_purchase(sup_flour, "SLFM/26-27/114", month_start + timedelta(days=1), [
            (flour, "150", "kg", 4200, 0),
            (spice, "10", "kg", 20000, 500),
        ])
        add_purchase(sup_oil, "AOT/26-27/089", month_start + timedelta(days=2), [
            (oil, "60", "l", 14200, 500),
            (pouch, "1000", "pcs", 240, 1800),
            (carton, "60", "pcs", 1500, 1800),
        ])

        # Production runs: 2 completed, 1 issued, 1 planned
        r1 = prod.create_run(db, prod_user, murukku.id, today - timedelta(days=5), batches=Decimal("1"), notes="Morning shift batch")
        prod.issue_materials(db, prod_user, r1, [
            {"item_id": flour.id, "qty": "40", "unit": "kg"},
            {"item_id": oil.id, "qty": "10.6", "unit": "l"},  # slight variance > 3%
            {"item_id": spice.id, "qty": "1.2", "unit": "kg"},
        ], today - timedelta(days=5))
        prod.add_overhead(db, prod_user, r1, "LABOUR", 85000, "2 operators shift", today - timedelta(days=5))
        prod.add_overhead(db, prod_user, r1, "GAS_POWER", 42000, "Fryer gas", today - timedelta(days=5))
        prod.complete_run(db, prod_user, r1, 196, 4, [
            {"item_id": pouch.id, "qty": "200", "unit": "pcs"},
            {"item_id": carton.id, "qty": "10", "unit": "pcs"},
        ], [], today - timedelta(days=5))

        r2 = prod.create_run(db, prod_user, ribbon.id, today - timedelta(days=2), batches=Decimal("1"), notes="Afternoon batch")
        prod.issue_materials(db, prod_user, r2, [
            {"item_id": flour.id, "qty": "35", "unit": "kg"},
            {"item_id": oil.id, "qty": "9", "unit": "l"},
            {"item_id": spice.id, "qty": "1.5", "unit": "kg"},
        ], today - timedelta(days=2))
        prod.add_overhead(db, prod_user, r2, "LABOUR", 75000, "Shift labour", today - timedelta(days=2))
        prod.complete_run(db, prod_user, r2, 152, 2, [
            {"item_id": pouch.id, "qty": "154", "unit": "pcs"},
            {"item_id": carton.id, "qty": "8", "unit": "pcs"},
        ], [], today - timedelta(days=2))

        r3 = prod.create_run(db, prod_user, mixture.id, today, batches=Decimal("1"), notes="In progress today")
        prod.issue_materials(db, prod_user, r3, [
            {"item_id": flour.id, "qty": "32", "unit": "kg"},
            {"item_id": oil.id, "qty": "11", "unit": "l"},
            {"item_id": spice.id, "qty": "2", "unit": "kg"},
        ], today)

        prod.create_run(db, prod_user, murukku.id, today + timedelta(days=1), batches=Decimal("2"), notes="Tomorrow morning plan")

        # Orders across all statuses:
        # 1. Dispatched + partially paid
        o1, _ = svc.create_order(db, sales_a, cust_a.id, [
            {"item_id": murukku.id, "qty": 60, "unit": "packet"},
            {"item_id": ribbon.id, "qty": 30, "unit": "packet"},
        ], "demo-ord-0001", "Deliver before 5 PM", None)
        svc.approve(db, admin, o1, False)
        inv1 = svc.create_invoice(db, admin, o1)
        svc.dispatch(db, admin, inv1, None, "TN-45-AK-4821", "Dispatched via van")
        pay.record_payment(db, admin, cust_a.id, 300000, "UPI", "UPI/43219876", inv1.id, "demo-pay-0001", today - timedelta(days=1))

        # 2. Dispatched + unpaid (top debtor)
        o2, _ = svc.create_order(db, sales_b, cust_b.id, [
            {"item_id": murukku.id, "qty": 100, "unit": "packet"},
            {"item_id": mixture.id, "qty": 50, "unit": "packet"},
        ], "demo-ord-0002", "Interstate dispatch", None)
        svc.approve(db, admin, o2, False)
        inv2 = svc.create_invoice(db, admin, o2)
        svc.dispatch(db, admin, inv2, None, "KA-01-MG-9012", "Transport LR-884")

        # 3. Invoiced (awaiting dispatch)
        o3, _ = svc.create_order(db, sales_a, cust_d.id, [
            {"item_id": ribbon.id, "qty": 40, "unit": "packet"},
            {"item_id": mixture.id, "qty": 25, "unit": "packet"},
        ], "demo-ord-0003", "Chennai branch order", None)
        svc.approve(db, admin, o3, False)
        svc.create_invoice(db, admin, o3)

        # 4. Approved (awaiting invoice)
        o4, _ = svc.create_order(db, sales_a, cust_c.id, [
            {"item_id": murukku.id, "qty": 20, "unit": "packet"},
        ], "demo-ord-0004", "Puducherry weekend stock", None)
        svc.approve(db, admin, o4, False)

        # 5. Submitted (pending approval in inbox!)
        svc.create_order(db, sales_a, cust_d.id, [
            {"item_id": murukku.id, "qty": 30, "unit": "packet"},
            {"item_id": ribbon.id, "qty": 20, "unit": "packet"},
        ], "demo-ord-0005", "Urgent replenishment", None)

        svc.create_order(db, sales_b, cust_e.id, [
            {"item_id": mixture.id, "qty": 15, "unit": "packet"},
        ], "demo-ord-0006", "Cash on delivery", None)

        # 6. Rejected
        o7, _ = svc.create_order(db, sales_b, cust_e.id, [
            {"item_id": murukku.id, "qty": 40, "unit": "packet"},
        ], "demo-ord-0007", "Duplicate request", None)
        svc.reject(db, admin, o7, "Customer asked to hold until next week")

        # 7. Cancelled invoice with credit note
        o8, _ = svc.create_order(db, sales_a, cust_c.id, [
            {"item_id": ribbon.id, "qty": 10, "unit": "packet"},
        ], "demo-ord-0008", "Wrong billing GSTIN", None)
        svc.approve(db, admin, o8, False)
        inv8 = svc.create_invoice(db, admin, o8)
        svc.cancel_invoice(db, admin, inv8, "Wrong customer branch billed")

        db.commit()
        print("Demo sample records seeded successfully!")


if __name__ == "__main__":
    run_demo_seed()
