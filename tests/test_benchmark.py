"""Runs the section-5 benchmark scenario end to end through the HTTP API and asserts every 'result we will check'."""
from .conftest import ids

API = "/api/v1"


def test_benchmark_end_to_end(client, H):
    items, custs = ids(client, H)
    A, P = H["admin"], H["production"]
    stock = lambda kind=None: {r["sku"]: r for r in client.get(f"{API}/inventory/summary", headers=A).json()}

    # 1. purchase 60 kg flour @ 45
    sup = client.get(f"{API}/suppliers", headers=A).json()[0]["id"]
    r = client.post(f"{API}/purchases", headers=P, json={"supplier_id": sup, "lines": [{"item_id": items["FLOUR"], "qty": "60", "unit": "kg", "rate_paise": 4500}]})
    assert r.status_code == 201 and r.json()["taxable_paise"] == 270000

    # 2. production run: issue 40 kg flour, 10.5 L oil, 1.2 kg spice
    run = client.post(f"{API}/production/runs", headers=P, json={"product_id": items["MUR200"], "batches": "1"}).json()
    assert run["planned_output"] == 200
    r = client.post(f"{API}/production/runs/{run['id']}/issue", headers=P, json={"lines": [
        {"item_id": items["FLOUR"], "qty": "40", "unit": "kg"}, {"item_id": items["OIL"], "qty": "10.5", "unit": "l"}, {"item_id": items["SPICE"], "qty": "1.2", "unit": "kg"}]})
    assert r.status_code == 200

    # 3. output 188 good, 6 pouches damaged, 9 cartons used (pouches used 188)
    r = client.post(f"{API}/production/runs/{run['id']}/complete", headers=P, json={
        "good_output": 188, "packaging_used": [{"item_id": items["POUCH200"], "qty": "188", "unit": "pcs"}, {"item_id": items["CARTON20"], "qty": "9", "unit": "pcs"}],
        "wastage": [{"item_id": items["POUCH200"], "qty": "6", "unit": "pcs", "reason": "damaged"}]})
    assert r.status_code == 200, r.text
    done = r.json()
    s = stock()
    assert s["FLOUR"]["qty"] == "120" and s["OIL"]["qty"] == "19.5" and s["POUCH200"]["qty"] == "306" and s["CARTON20"]["qty"] == "21"
    assert s["MUR200"]["qty"] == "238"
    y = done["variance"]["yield"]
    assert (y["planned"], y["actual"], y["variance_pct"], y["flagged"]) == (200, 188, "-6.00", True)
    byname = {l["name"]: l for l in done["variance"]["lines"]}
    assert byname["Cooking oil"]["variance_pct"] == "5.00" and byname["Cooking oil"]["flagged"]
    assert not byname["Flour"]["flagged"] and not byname["Salt and spice mix"]["flagged"]
    assert byname["200 g pouch"]["variance_pct"] == "-3.00" and not byname["200 g pouch"]["flagged"]  # exactly at tolerance, not beyond
    assert byname["Carton (holds 20 packets)"]["flagged"]

    # 4-5. Salesman A orders 150 for Retailer A -> admin approves, invoices, dispatches
    r = client.post(f"{API}/orders", headers=H["salesman_a"], json={"customer_id": custs["Retailer A"], "client_ref": "11111111-aaaa", "lines": [{"item_id": items["MUR200"], "qty": 150}]})
    assert r.status_code == 201
    oa = r.json()
    assert oa["lines"][0]["price_paise"] == 5000
    chk = client.get(f"{API}/orders/{oa['id']}/stock-check", headers=A).json()
    assert chk["sufficient"] and chk["lines"][0]["available"] == 238
    r = client.post(f"{API}/orders/{oa['id']}/approve", headers=A, json={})
    assert r.status_code == 200
    inv_a = client.post(f"{API}/orders/{oa['id']}/invoice", headers=A).json()
    assert (inv_a["taxable_paise"], inv_a["cgst_paise"], inv_a["sgst_paise"], inv_a["igst_paise"], inv_a["total_paise"]) == (750000, 18750, 18750, 0, 787500)
    assert inv_a["invoice_no"].startswith("INV/") and inv_a["invoice_no"].endswith("/0001")
    r = client.post(f"{API}/invoices/{inv_a['id']}/dispatch", headers=A, json={"vehicle_no": "TN45AB1234"})
    assert r.status_code == 201
    lots = r.json()["lines"]
    assert [(l["batch_no"], l["qty"]) for l in lots][0] == ("OPENING", 50)  # FEFO: older/unknown-expiry lot first
    assert stock()["MUR200"]["qty"] == "88"
    assert client.get(f"{API}/orders/{oa['id']}", headers=H["salesman_a"]).json()["status"] == "DISPATCHED"
    pdf = client.get(f"{API}/invoices/{inv_a['id']}/pdf", headers=A)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"

    # 6. Salesman B orders 120 for Distributor B (Karnataka): shortage of 32
    ob = client.post(f"{API}/orders", headers=H["salesman_b"], json={"customer_id": custs["Distributor B"], "client_ref": "22222222-bbbb", "lines": [{"item_id": items["MUR200"], "qty": 120}]}).json()
    chk = client.get(f"{API}/orders/{ob['id']}/stock-check", headers=A).json()
    assert not chk["sufficient"] and chk["lines"][0]["shortage"] == 32 and chk["lines"][0]["suggested_batches_to_produce"] == 1
    r = client.post(f"{API}/orders/{ob['id']}/approve", headers=A, json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "insufficient_stock"
    r = client.post(f"{API}/orders/{ob['id']}/approve", headers=A, json={"accept_shortage": True, "raise_invoice": True})
    assert r.status_code == 200
    inv_b = r.json()["invoice"]
    assert inv_b["supply_type"] == "INTER" and inv_b["igst_paise"] == 30000 and inv_b["cgst_paise"] == 0 and inv_b["total_paise"] == 630000  # 6000 + 5% IGST 300
    r = client.post(f"{API}/invoices/{inv_b['id']}/dispatch", headers=A, json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "insufficient_stock"  # never dispatch what is not there
    assert stock()["MUR200"]["qty"] == "88"
    part = client.post(f"{API}/invoices/{inv_b['id']}/dispatch", headers=A, json={"lines": [{"invoice_line_id": inv_b["lines"][0]["id"], "qty": 88}]})
    assert part.status_code == 201 and stock()["MUR200"]["qty"] == "0"
    assert client.get(f"{API}/invoices/{inv_b['id']}", headers=A).json()["dispatch_status"] == "PARTIAL"

    # 7. payment 4000 from Retailer A
    p = client.post(f"{API}/payments", headers=A, json={"customer_id": custs["Retailer A"], "amount_paise": 400000, "mode": "UPI", "reference": "UTR123", "client_ref": "pay-00000001"})
    assert p.status_code == 201
    assert client.post(f"{API}/payments", headers=A, json={"customer_id": custs["Retailer A"], "amount_paise": 400000, "mode": "UPI", "client_ref": "pay-00000001"}).status_code == 200  # idempotent retry
    acct = client.get(f"{API}/customers/{custs['Retailer A']}/account", headers=A).json()
    assert acct["outstanding_paise"] == 387500

    # 8. overheads then cost per packet
    for cat, amt in (("LABOUR", 120000), ("GAS_POWER", 60000)):
        assert client.post(f"{API}/production/runs/{run['id']}/overheads", headers=P, json={"category": cat, "amount_paise": amt}).status_code == 201
    run_after = client.get(f"{API}/production/runs/{run['id']}", headers=P).json()
    c = run_after["cost"]
    # materials: flour 40kg @ WAC 43.125 = 1725.00, oil 1470, spice 240, pouches 194*2.5 = 485, cartons 9*15 = 135  => 4055.00
    assert c["material_paise"] == 405500 and c["overhead_paise"] == 180000 and c["total_paise"] == 585500
    assert c["cost_per_packet_paise"] == 3114 and c["margin_paise"] == 1886

    # 9. reports
    for key in ("sales-register", "customer-sales", "product-sales", "gst-summary", "purchase-register", "stock-summary", "stock-ledger", "production-report", "collections", "outstanding", "cost-per-packet", "batch-stock"):
        for fmt, magic in (("json", None), ("csv", None), ("xlsx", b"PK"), ("pdf", b"%PDF")):
            r = client.get(f"{API}/reports/{key}?format={fmt}", headers=H["accountant"])
            assert r.status_code == 200, (key, fmt, r.text[:200])
            if magic:
                assert r.content[:len(magic)] == magic
    gst = client.get(f"{API}/reports/gst-summary", headers=H["accountant"]).json()
    s3b = [s for s in gst["sections"] if s["title"].startswith("GSTR-3B")][0]["rows"][0]
    assert (s3b["taxable"], s3b["cgst"], s3b["sgst"], s3b["igst"]) == (1350000, 18750, 18750, 30000)
    out = client.get(f"{API}/reports/outstanding", headers=H["accountant"]).json()["sections"][0]
    assert {r["customer"]: r["total"] for r in out["rows"]} == {"Retailer A": 387500, "Distributor B": 630000}
    ss = {r["item"]: r for r in client.get(f"{API}/reports/stock-summary", headers=H["accountant"]).json()["sections"][0]["rows"]}
    assert ss["Flour"]["opening"] == "100" and ss["Flour"]["receipts"] == "60" and ss["Flour"]["issues"] == "40" and ss["Flour"]["closing"] == "120"
    assert client.get(f"{API}/inventory/reconcile", headers=A).json()["ok"]
    dash = client.get(f"{API}/dashboard", headers=H["owner"]).json()
    assert dash["outstanding"]["total_paise"] == 1017500 and len(dash["variance_alerts"]) >= 3
    cost = client.get(f"{API}/costing?month={run_after['mfg_date'][:7]}", headers=H["owner"]).json()
    assert cost["products"][0]["cost_per_packet_paise"] == 3114
