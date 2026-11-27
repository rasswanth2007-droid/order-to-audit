import pytest
from sqlalchemy import select, update
from app import models as m
from app.db import SessionLocal
from app.errors import ImmutableRecord
from .conftest import PW, ids, login

API = "/api/v1"


def _order(client, H, who, cust, item, qty, ref):
    return client.post(f"{API}/orders", headers=H[who], json={"customer_id": cust, "client_ref": ref, "lines": [{"item_id": item, "qty": qty}]})


def test_auth_required_and_roles(client, H):
    items, custs = ids(client, H)
    assert client.get(f"{API}/items").status_code == 401
    assert client.get(f"{API}/dashboard", headers=H["salesman_a"]).status_code == 403
    assert client.post(f"{API}/production/runs", headers=H["salesman_a"], json={"product_id": items["MUR200"]}).status_code == 403
    assert client.get(f"{API}/reports/sales-register", headers=H["production"]).status_code == 403
    assert client.get(f"{API}/reports/stock-summary", headers=H["production"]).status_code == 200
    assert client.post(f"{API}/payments", headers=H["accountant"], json={"customer_id": custs["Retailer A"], "amount_paise": 100, "mode": "CASH"}).status_code == 403  # accountant is read-only
    assert client.post(f"{API}/users", headers=H["production"], json={"username": "x1234", "full_name": "x", "password": "Abcdefghij1", "role": "ADMIN"}).status_code == 403
    assert [i["kind"] for i in client.get(f"{API}/items", headers=H["salesman_a"]).json()] == ["FINISHED"]  # salesman never sees raw-material masters


def test_idor_and_idempotent_orders(client, H):
    items, custs = ids(client, H)
    r1 = _order(client, H, "salesman_a", custs["Retailer A"], items["MUR200"], 10, "ref-aaaaaaaa")
    r2 = _order(client, H, "salesman_a", custs["Retailer A"], items["MUR200"], 10, "ref-aaaaaaaa")
    assert r1.status_code == 201 and r2.status_code == 200 and r2.json()["duplicate"] and r1.json()["id"] == r2.json()["id"]
    assert client.get(f"{API}/orders/{r1.json()['id']}", headers=H["salesman_b"]).status_code == 404  # other salesman's order
    assert _order(client, H, "salesman_b", custs["Retailer A"], items["MUR200"], 5, "ref-bbbbbbbb").status_code == 403  # customer assigned to A
    assert client.get(f"{API}/orders", headers=H["salesman_b"]).json()["total"] == 0
    sync = client.post(f"{API}/orders/sync", headers=H["salesman_a"], json={"orders": [
        {"customer_id": custs["Retailer A"], "client_ref": "ref-aaaaaaaa", "lines": [{"item_id": items["MUR200"], "qty": 10}]},
        {"customer_id": 9999, "client_ref": "ref-cccccccc", "lines": [{"item_id": items["MUR200"], "qty": 1}]}]}).json()["results"]
    assert sync[0]["ok"] and sync[0]["duplicate"] and not sync[1]["ok"]


def test_salesman_cannot_set_price_and_extra_fields_rejected(client, H):
    items, custs = ids(client, H)
    r = client.post(f"{API}/orders", headers=H["salesman_a"], json={"customer_id": custs["Retailer A"], "client_ref": "ref-dddddddd", "lines": [{"item_id": items["MUR200"], "qty": 1, "price_paise": 1}]})
    assert r.status_code == 422


def test_negative_stock_blocked_and_unit_validation(client, H):
    items, _ = ids(client, H)
    run = client.post(f"{API}/production/runs", headers=H["production"], json={"product_id": items["MUR200"]}).json()
    r = client.post(f"{API}/production/runs/{run['id']}/issue", headers=H["production"], json={"lines": [{"item_id": items["FLOUR"], "qty": "500", "unit": "kg"}]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "insufficient_stock"
    assert client.post(f"{API}/production/runs/{run['id']}/issue", headers=H["production"], json={"lines": [{"item_id": items["FLOUR"], "qty": "5", "unit": "litre"}]}).status_code == 422
    assert client.post(f"{API}/production/runs/{run['id']}/complete", headers=H["production"], json={"good_output": 10}).status_code == 409  # must issue first
    flour = [r for r in client.get(f"{API}/inventory/summary", headers=H["admin"]).json() if r["sku"] == "FLOUR"][0]
    assert flour["qty"] == "100"  # failed issues left nothing behind


def test_credit_note_cancellation_returns_stock(client, H):
    items, custs = ids(client, H)
    A = H["admin"]
    o = _order(client, H, "salesman_a", custs["Retailer A"], items["MUR200"], 20, "ref-eeeeeeee").json()
    client.post(f"{API}/orders/{o['id']}/approve", headers=A, json={"raise_invoice": True})
    inv = client.get(f"{API}/orders/{o['id']}", headers=A).json()["invoice"]
    client.post(f"{API}/invoices/{inv['id']}/dispatch", headers=A, json={})
    stock = lambda: {r["sku"]: r["qty"] for r in client.get(f"{API}/inventory/summary", headers=A).json()}["MUR200"]
    assert stock() == "30"
    r = client.post(f"{API}/invoices/{inv['id']}/cancel", headers=A, json={"reason": "wrong customer"})
    assert r.status_code == 200 and r.json()["stock_returned"] and stock() == "50"
    d = client.get(f"{API}/invoices/{inv['id']}", headers=A).json()
    assert d["status"] == "CANCELLED" and d["credit_note"]["cn_no"].startswith("CN/")
    assert client.post(f"{API}/invoices/{inv['id']}/cancel", headers=A, json={"reason": "again please"}).status_code == 409
    assert client.get(f"{API}/inventory/reconcile", headers=A).json()["ok"]
    acts = [a["action"] for a in client.get(f"{API}/audit?entity=invoice", headers=H["accountant"]).json()["items"]]
    assert "INVOICE_CANCEL" in acts and "INVOICE_CREATE" in acts


def test_paid_invoice_cannot_be_cancelled_and_overpayment_is_advance(client, H):
    items, custs = ids(client, H)
    A = H["admin"]
    o = _order(client, H, "salesman_a", custs["Retailer A"], items["MUR200"], 10, "ref-ffffffff").json()
    client.post(f"{API}/orders/{o['id']}/approve", headers=A, json={"raise_invoice": True})
    inv = client.get(f"{API}/orders/{o['id']}", headers=A).json()["invoice"]  # 10 x 50 = 500 + 25 = 525
    assert inv["total_paise"] == 52500
    p = client.post(f"{API}/payments", headers=A, json={"customer_id": custs["Retailer A"], "amount_paise": 60000, "mode": "CASH"}).json()
    assert p["unallocated_paise"] == 7500
    assert client.post(f"{API}/invoices/{inv['id']}/cancel", headers=A, json={"reason": "customer cancelled"}).status_code == 409


def test_ledger_and_audit_are_append_only(client, H):
    with SessionLocal() as db:
        row = db.execute(select(m.StockLedger)).scalars().first()
        row.qty_delta = 999
        with pytest.raises(ImmutableRecord):
            db.flush()
        db.rollback()
        a = m.AuditLog(action="X", entity="t")
        db.add(a); db.commit()
        with pytest.raises(ImmutableRecord):
            db.delete(a); db.flush()
        db.rollback()


def test_login_lockout_and_password_rules(client, H):
    for _ in range(5):
        assert client.post(f"{API}/auth/login", json={"username": "owner", "password": "wrong"}).status_code == 401
    assert client.post(f"{API}/auth/login", json={"username": "owner", "password": PW}).status_code == 429
    r = client.post(f"{API}/auth/change-password", headers=H["admin"], json={"current_password": PW, "new_password": "alllowercase1"})
    assert r.status_code == 422
    r = client.post(f"{API}/auth/change-password", headers=H["admin"], json={"current_password": PW, "new_password": "NewStrong#Pass9"})
    assert r.status_code == 200
    assert client.get(f"{API}/auth/me", headers=H["admin"]).status_code == 401  # old token revoked


def test_csv_formula_injection_neutralised(client, H):
    from app.services.exporters import Report, Section, to_csv
    rep = Report("x", "t", "p", [Section("s", [("a", "A", "text")], [{"a": "=HYPERLINK(\"http://evil\")"}, {"a": "-5"}])])
    out = to_csv(rep).decode()
    assert "'=HYPERLINK" in out and "-5" in out and "'-5" not in out


def test_variance_tolerance_setting_and_security_headers(client, H):
    r = client.put(f"{API}/settings", headers=H["admin"], json={"variance_tolerance_pct": "10"})
    assert r.json()["variance_tolerance_pct"] == "10.00"
    h = client.get("/health").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"
