from decimal import Decimal
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models as m, schemas as s
from ..audit import audit
from ..db import get_db
from ..deps import ADMIN, current_user, require
from ..errors import Conflict, Forbidden, NotFound, ValidationFailed
from ..services import production as prod
from ..units import BASE_LABEL, qty_view, to_base
from ..util import company, get_setting, set_setting, tolerance_bp

router = APIRouter(tags=["masters"])
READERS = require("ADMIN", "OWNER", "ACCOUNTANT", "PRODUCTION")
WRITERS = require("ADMIN", "PRODUCTION")


def item_view(i: m.Item) -> dict:
    return {"id": i.id, "sku": i.sku, "name": i.name, "kind": i.kind, "dimension": i.dimension, "display_unit": i.display_unit, "base_unit": BASE_LABEL[i.dimension],
            "hsn_code": i.hsn_code, "gst_rate_bp": i.gst_rate_bp, "selling_price_paise": i.selling_price_paise, "packets_per_carton": i.packets_per_carton,
            "shelf_life_days": i.shelf_life_days, "reorder_level": qty_view(i, i.reorder_level_base)["qty"], "is_active": i.is_active}


def _dim(unit): return {"kg": "MASS", "g": "MASS", "l": "VOLUME", "ml": "VOLUME", "pcs": "COUNT", "packet": "COUNT"}[unit]


@router.get("/items")
def list_items(kind: str | None = None, active_only: bool = True, user: m.User = Depends(current_user), db: Session = Depends(get_db)):
    q = select(m.Item).order_by(m.Item.kind, m.Item.name)
    if kind:
        q = q.where(m.Item.kind == kind)
    if active_only:
        q = q.where(m.Item.is_active.is_(True))
    if user.role == "SALESMAN":
        q = q.where(m.Item.kind == "FINISHED")
    return [item_view(i) for i in db.execute(q).scalars()]


@router.post("/items", status_code=201)
def create_item(body: s.ItemIn, user: m.User = Depends(WRITERS), db: Session = Depends(get_db)):
    if body.kind == "FINISHED" and user.role != "ADMIN":
        raise Forbidden("Only admin can create finished products")
    if db.execute(select(m.Item).where(m.Item.sku == body.sku)).scalar_one_or_none():
        raise Conflict("SKU already exists")
    if body.kind == "FINISHED" and (body.display_unit != "packet" or body.selling_price_paise is None):
        raise ValidationFailed("Finished products are counted in 'packet' and need a selling price")
    if body.kind != "FINISHED" and body.display_unit == "packet":
        raise ValidationFailed("'packet' unit is for finished products only")
    it = m.Item(sku=body.sku, name=body.name, kind=body.kind, dimension=_dim(body.display_unit), display_unit=body.display_unit, hsn_code=body.hsn_code,
                gst_rate_bp=body.gst_rate_bp, selling_price_paise=body.selling_price_paise, packets_per_carton=body.packets_per_carton, shelf_life_days=body.shelf_life_days)
    db.add(it)
    db.flush()
    it.reorder_level_base = to_base(it, body.reorder_level, body.display_unit)
    audit(db, user, "ITEM_CREATE", "item", it.id, None, item_view(it))
    db.commit()
    return item_view(it)


@router.patch("/items/{item_id}")
def update_item(item_id: int, body: s.ItemUpdate, user: m.User = Depends(WRITERS), db: Session = Depends(get_db)):
    it = db.get(m.Item, item_id)
    if not it:
        raise NotFound("Item not found")
    if it.kind == "FINISHED" and user.role != "ADMIN":
        raise Forbidden("Only admin can edit finished products")
    before = item_view(it)
    data = body.model_dump(exclude_unset=True)
    reorder = data.pop("reorder_level", None)
    for k, v in data.items():
        setattr(it, k, v)
    if reorder is not None:
        it.reorder_level_base = to_base(it, reorder, it.display_unit)
    audit(db, user, "ITEM_UPDATE", "item", it.id, before, item_view(it))
    db.commit()
    return item_view(it)


def cust_view(c: m.Customer, full: bool = True) -> dict:
    d = {"id": c.id, "name": c.name, "type": c.type, "state_code": c.state_code, "gstin": c.gstin, "phone": c.phone, "address": c.address}
    if full:
        d.update({"credit_days": c.credit_days, "salesman_id": c.salesman_id, "is_active": c.is_active})
    return d


@router.get("/customers")
def list_customers(q: str | None = None, user: m.User = Depends(current_user), db: Session = Depends(get_db)):
    st = select(m.Customer).where(m.Customer.is_active.is_(True)).order_by(m.Customer.name)
    if user.role == "SALESMAN":
        st = st.where((m.Customer.salesman_id == user.id) | (m.Customer.salesman_id.is_(None)))
    if q:
        st = st.where(m.Customer.name.ilike(f"%{q[:60]}%"))
    return [cust_view(c, full=user.role != "SALESMAN") for c in db.execute(st.limit(500)).scalars()]


@router.post("/customers", status_code=201)
def create_customer(body: s.CustomerIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    c = m.Customer(**body.model_dump())
    db.add(c)
    db.flush()
    audit(db, user, "CUSTOMER_CREATE", "customer", c.id, None, cust_view(c))
    db.commit()
    return cust_view(c)


@router.put("/customers/{cid}")
def update_customer(cid: int, body: s.CustomerIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    c = db.get(m.Customer, cid)
    if not c:
        raise NotFound("Customer not found")
    before = cust_view(c)
    for k, v in body.model_dump().items():
        setattr(c, k, v)
    audit(db, user, "CUSTOMER_UPDATE", "customer", c.id, before, cust_view(c))
    db.commit()
    return cust_view(c)


@router.get("/customers/{cid}/prices")
def customer_prices(cid: int, _: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    return [{"item_id": p.item_id, "price_paise": p.price_paise} for p in db.execute(select(m.CustomerPrice).where(m.CustomerPrice.customer_id == cid)).scalars()]


@router.put("/customers/{cid}/prices")
def set_customer_price(cid: int, body: s.CustomerPriceIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    if not db.get(m.Customer, cid) or not db.get(m.Item, body.item_id):
        raise NotFound("Customer or item not found")
    row = db.execute(select(m.CustomerPrice).where(m.CustomerPrice.customer_id == cid, m.CustomerPrice.item_id == body.item_id)).scalar_one_or_none()
    before = row.price_paise if row else None
    if row:
        row.price_paise = body.price_paise
    else:
        db.add(m.CustomerPrice(customer_id=cid, item_id=body.item_id, price_paise=body.price_paise))
    audit(db, user, "CUSTOMER_PRICE", "customer", cid, {"price": before}, {"item_id": body.item_id, "price": body.price_paise})
    db.commit()
    return {"item_id": body.item_id, "price_paise": body.price_paise}


def sup_view(x: m.Supplier) -> dict:
    return {"id": x.id, "name": x.name, "gstin": x.gstin, "state_code": x.state_code, "phone": x.phone, "address": x.address, "is_active": x.is_active}


@router.get("/suppliers")
def list_suppliers(_: m.User = Depends(READERS), db: Session = Depends(get_db)):
    return [sup_view(x) for x in db.execute(select(m.Supplier).order_by(m.Supplier.name)).scalars()]


@router.post("/suppliers", status_code=201)
def create_supplier(body: s.SupplierIn, user: m.User = Depends(WRITERS), db: Session = Depends(get_db)):
    x = m.Supplier(**body.model_dump())
    db.add(x)
    db.flush()
    audit(db, user, "SUPPLIER_CREATE", "supplier", x.id, None, sup_view(x))
    db.commit()
    return sup_view(x)


def bom_view(b: m.Bom) -> dict:
    return {"product_id": b.product_id, "product": b.product.name, "yield_qty": b.yield_qty, "version": b.version,
            "lines": [{"item_id": l.item_id, "name": l.item.name, "kind": l.item.kind, **qty_view(l.item, l.qty_base)} for l in b.lines]}


@router.get("/boms")
def list_boms(_: m.User = Depends(READERS), db: Session = Depends(get_db)):
    return [bom_view(b) for b in db.execute(select(m.Bom)).scalars()]


@router.get("/boms/{product_id}")
def get_bom(product_id: int, _: m.User = Depends(READERS), db: Session = Depends(get_db)):
    return bom_view(prod.get_bom(db, product_id))


@router.put("/boms/{product_id}")
def put_bom(product_id: int, body: s.BomIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    b = prod.save_bom(db, user, product_id, body.yield_qty, [l.model_dump() for l in body.lines])
    db.commit()
    return bom_view(b)


@router.get("/settings")
def get_settings_(_: m.User = Depends(READERS), db: Session = Depends(get_db)):
    return {"variance_tolerance_pct": f"{tolerance_bp(db) / 100:.2f}", "company": company(db)}


@router.put("/settings")
def put_settings(body: s.SettingsIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    before = {"tol": tolerance_bp(db), "company": company(db)}
    if body.variance_tolerance_pct is not None:
        set_setting(db, "variance_tolerance_bp", int(body.variance_tolerance_pct * 100))
    if body.company is not None:
        allowed = {"name", "gstin", "state_code", "state_name", "address", "phone", "email", "invoice_prefix", "bank"}
        bad = set(body.company) - allowed
        if bad:
            raise ValidationFailed(f"Unknown company fields: {sorted(bad)}")
        set_setting(db, "company", {**(get_setting(db, "company", {}) or {}), **body.company})
    audit(db, user, "SETTINGS", "settings", None, before, {"tol": tolerance_bp(db), "company": company(db)})
    db.commit()
    return get_settings_(user, db)


def _scheme_view(sc: m.Scheme) -> dict:
    return {"id": sc.id, "name": sc.name, "item_id": sc.item_id, "item": sc.item.name, "min_qty": sc.min_qty,
            "discount_pct": f"{sc.discount_bp / 100:.2f}", "discount_bp": sc.discount_bp, "is_active": sc.is_active}


@router.get("/schemes")
def list_schemes(_: m.User = Depends(current_user), db: Session = Depends(get_db)):
    return [_scheme_view(sc) for sc in db.execute(select(m.Scheme).order_by(m.Scheme.id.desc())).scalars()]


@router.post("/schemes", status_code=201)
def create_scheme(body: s.SchemeIn, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    it = db.get(m.Item, body.item_id)
    if not it or it.kind != "FINISHED":
        raise ValidationFailed("Schemes apply to finished products only")
    sc = m.Scheme(name=body.name, item_id=body.item_id, min_qty=body.min_qty,
                  discount_bp=int(body.discount_pct * 100), is_active=body.is_active)
    db.add(sc)
    db.flush()
    audit(db, user, "SCHEME_CREATE", "scheme", sc.id, None, _scheme_view(sc))
    db.commit()
    return _scheme_view(sc)


@router.patch("/schemes/{sid}")
def toggle_scheme(sid: int, user: m.User = Depends(ADMIN), db: Session = Depends(get_db)):
    sc = db.get(m.Scheme, sid)
    if not sc:
        raise NotFound("Scheme not found")
    sc.is_active = not sc.is_active
    audit(db, user, "SCHEME_TOGGLE", "scheme", sc.id, None, {"is_active": sc.is_active})
    db.commit()
    return _scheme_view(sc)
