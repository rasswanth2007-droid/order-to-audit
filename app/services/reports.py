from collections import defaultdict
from datetime import date
from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models as m
from ..errors import ValidationFailed
from ..money import round_div
from ..units import dec_str, from_base
from ..util import STATE_NAMES, company, month_range, today_ist
from . import costing, inventory as inv, payments as pay, production as prod
from .exporters import Report, Section


def _period(a: date, b: date) -> str:
    return f"{a:%d-%b-%Y} to {b:%d-%b-%Y}"


def _q(item, base):
    return dec_str(from_base(item, base))


def _tot(rows, keys):
    return {k: sum(r.get(k) or 0 for r in rows) for k in keys}


def sales_register(db, a, b):
    invs = db.execute(select(m.Invoice).where(m.Invoice.invoice_date.between(a, b)).order_by(m.Invoice.invoice_date, m.Invoice.id)).scalars().all()
    rows = [{"date": i.invoice_date, "invoice_no": i.invoice_no, "customer": i.buyer_name, "gstin": i.buyer_gstin or "Unregistered", "pos": i.place_of_supply,
             "supply": i.supply_type, "taxable": i.taxable_paise, "cgst": i.cgst_paise, "sgst": i.sgst_paise, "igst": i.igst_paise, "round_off": i.round_off_paise,
             "total": i.total_paise, "status": i.status} for i in invs]
    cns = db.execute(select(m.CreditNote).where(m.CreditNote.cn_date.between(a, b)).order_by(m.CreditNote.id)).scalars().all()
    cn_rows = [{"date": c.cn_date, "cn_no": c.cn_no, "against": c.invoice.invoice_no, "customer": c.invoice.buyer_name, "taxable": c.taxable_paise,
                "cgst": c.cgst_paise, "sgst": c.sgst_paise, "igst": c.igst_paise, "total": c.total_paise, "reason": c.reason} for c in cns]
    cols = [("date", "Date", "date"), ("invoice_no", "Invoice No", "text"), ("customer", "Customer", "text"), ("gstin", "GSTIN", "text"), ("pos", "POS", "text"),
            ("supply", "Supply", "text"), ("taxable", "Taxable", "money"), ("cgst", "CGST", "money"), ("sgst", "SGST", "money"), ("igst", "IGST", "money"),
            ("round_off", "Round off", "money"), ("total", "Invoice total", "money"), ("status", "Status", "text")]
    live = [r for r in rows if r["status"] == "ISSUED"]
    return Report("sales-register", "Sales Register", _period(a, b), [
        Section("Invoices", cols, rows, _tot(live, ["taxable", "cgst", "sgst", "igst", "round_off", "total"])),
        Section("Credit notes", [("date", "Date", "date"), ("cn_no", "CN No", "text"), ("against", "Against invoice", "text"), ("customer", "Customer", "text"),
                                 ("taxable", "Taxable", "money"), ("cgst", "CGST", "money"), ("sgst", "SGST", "money"), ("igst", "IGST", "money"), ("total", "Total", "money"), ("reason", "Reason", "text")],
                cn_rows, _tot(cn_rows, ["taxable", "cgst", "sgst", "igst", "total"]))],
        ["Totals on the invoices table exclude cancelled invoices (each cancelled invoice has a credit note below)."])


def customer_sales(db, a, b):
    agg = defaultdict(lambda: dict(invoices=0, taxable=0, tax=0, total=0))
    for i in db.execute(select(m.Invoice).where(m.Invoice.invoice_date.between(a, b), m.Invoice.status == "ISSUED")).scalars():
        r = agg[i.buyer_name]
        r["invoices"] += 1; r["taxable"] += i.taxable_paise; r["tax"] += i.cgst_paise + i.sgst_paise + i.igst_paise; r["total"] += i.total_paise
    rows = [{"customer": k, **v} for k, v in sorted(agg.items())]
    return Report("customer-sales", "Customer-wise Sales", _period(a, b), [Section("Customers", [("customer", "Customer", "text"), ("invoices", "Invoices", "int"),
                  ("taxable", "Taxable", "money"), ("tax", "GST", "money"), ("total", "Total", "money")], rows, _tot(rows, ["invoices", "taxable", "tax", "total"]))])


def product_sales(db, a, b):
    agg = defaultdict(lambda: dict(qty=0, taxable=0, hsn=None))
    q = select(m.InvoiceLine).join(m.Invoice).where(m.Invoice.invoice_date.between(a, b), m.Invoice.status == "ISSUED")
    for l in db.execute(q).scalars():
        r = agg[l.description]; r["qty"] += l.qty; r["taxable"] += l.taxable_paise; r["hsn"] = l.hsn_code
    rows = [{"product": k, "hsn": v["hsn"], "qty": v["qty"], "taxable": v["taxable"]} for k, v in sorted(agg.items())]
    return Report("product-sales", "Product-wise Sales", _period(a, b), [Section("Products", [("product", "Product", "text"), ("hsn", "HSN", "text"),
                  ("qty", "Packets sold", "int"), ("taxable", "Taxable value", "money")], rows, _tot(rows, ["qty", "taxable"]))])


def gst_summary(db, a, b):
    co = company(db)
    invs = db.execute(select(m.Invoice).where(m.Invoice.invoice_date.between(a, b), m.Invoice.status == "ISSUED").order_by(m.Invoice.id)).scalars().all()
    cns = db.execute(select(m.CreditNote).where(m.CreditNote.cn_date.between(a, b))).scalars().all()
    b2b = [{"gstin": i.buyer_gstin, "receiver": i.buyer_name, "inv_no": i.invoice_no, "date": i.invoice_date, "value": i.total_paise,
            "pos": f"{i.place_of_supply}-{STATE_NAMES.get(i.place_of_supply, '')}", "reverse_charge": "N", "type": "Regular", "rate": f"{ln.gst_rate_bp / 100:g}",
            "taxable": ln.taxable_paise, "igst": ln.igst_paise, "cgst": ln.cgst_paise, "sgst": ln.sgst_paise} for i in invs if i.buyer_gstin for ln in i.lines]
    b2c = defaultdict(lambda: dict(taxable=0, igst=0, cgst=0, sgst=0))
    for i in invs:
        if not i.buyer_gstin:
            for ln in i.lines:
                r = b2c[(i.place_of_supply, ln.gst_rate_bp)]
                r["taxable"] += ln.taxable_paise; r["igst"] += ln.igst_paise; r["cgst"] += ln.cgst_paise; r["sgst"] += ln.sgst_paise
    b2c_rows = [{"type": "OE", "pos": f"{k[0]}-{STATE_NAMES.get(k[0], '')}", "rate": f"{k[1] / 100:g}", **v} for k, v in sorted(b2c.items())]
    cdn = [{"note_no": c.cn_no, "date": c.cn_date, "against": c.invoice.invoice_no, "gstin": c.invoice.buyer_gstin or "Unregistered", "taxable": c.taxable_paise,
            "igst": c.igst_paise, "cgst": c.cgst_paise, "sgst": c.sgst_paise, "value": c.total_paise} for c in cns]
    hsn = defaultdict(lambda: dict(desc="", qty=0, value=0, taxable=0, igst=0, cgst=0, sgst=0, rate=0))
    for i in invs:
        for ln in i.lines:
            r = hsn[(ln.hsn_code, ln.gst_rate_bp)]
            r["desc"] = ln.description; r["qty"] += ln.qty; r["taxable"] += ln.taxable_paise; r["igst"] += ln.igst_paise; r["cgst"] += ln.cgst_paise
            r["sgst"] += ln.sgst_paise; r["value"] += ln.taxable_paise + ln.igst_paise + ln.cgst_paise + ln.sgst_paise; r["rate"] = ln.gst_rate_bp
    hsn_rows = [{"hsn": k[0], "desc": v["desc"], "uqc": "PKT", "qty": v["qty"], "rate": f"{v['rate'] / 100:g}", "value": v["value"], "taxable": v["taxable"],
                 "igst": v["igst"], "cgst": v["cgst"], "sgst": v["sgst"]} for k, v in sorted(hsn.items(), key=lambda x: str(x[0]))]
    t = lambda key: sum(i.__dict__[key + "_paise"] for i in invs) - sum(c.__dict__[key + "_paise"] for c in cns)
    s3b = [{"nature": "3.1(a) Outward taxable supplies (other than zero rated, nil rated, exempt)", "taxable": t("taxable"), "igst": t("igst"), "cgst": t("cgst"), "sgst": t("sgst")}]
    money = lambda *ks: [(k, k.upper() if k in ("igst", "cgst", "sgst") else k.title(), "money") for k in ks]
    return Report("gst-summary", "GST Summary of Outward Supplies", _period(a, b), [
        Section("GSTR-1 4A/4B B2B", [("gstin", "GSTIN/UIN of recipient", "text"), ("receiver", "Receiver name", "text"), ("inv_no", "Invoice no", "text"), ("date", "Invoice date", "date"),
                ("value", "Invoice value", "money"), ("pos", "Place of supply", "text"), ("reverse_charge", "Reverse charge", "text"), ("type", "Invoice type", "text"),
                ("rate", "Rate %", "text")] + money("taxable", "igst", "cgst", "sgst"), b2b),
        Section("GSTR-1 7 B2C (Others)", [("type", "Type", "text"), ("pos", "Place of supply", "text"), ("rate", "Rate %", "text")] + money("taxable", "igst", "cgst", "sgst"), b2c_rows),
        Section("GSTR-1 9B Credit notes", [("note_no", "Note no", "text"), ("date", "Date", "date"), ("against", "Against invoice", "text"), ("gstin", "Recipient", "text")] + money("taxable", "igst", "cgst", "sgst") + [("value", "Note value", "money")], cdn),
        Section("GSTR-1 12 HSN summary", [("hsn", "HSN", "text"), ("desc", "Description", "text"), ("uqc", "UQC", "text"), ("qty", "Total qty", "int"), ("rate", "Rate %", "text"),
                ("value", "Total value", "money")] + money("taxable", "igst", "cgst", "sgst"), hsn_rows),
        Section("GSTR-3B 3.1 Outward supplies (net of credit notes)", [("nature", "Nature of supplies", "text")] + money("taxable", "igst", "cgst", "sgst"), s3b, _tot(s3b, ["taxable", "igst", "cgst", "sgst"]))],
        [f"Supplier GSTIN {co['gstin']}. Shape follows GSTR-1/3B tables for ease of filing; verify on the GST portal before filing. B2C large (>2.5L inter-state) split not modelled."])


def purchase_register(db, a, b):
    rows = []
    for p in db.execute(select(m.Purchase).where(m.Purchase.purchase_date.between(a, b)).order_by(m.Purchase.purchase_date, m.Purchase.id)).scalars():
        for l in p.lines:
            rows.append({"date": p.purchase_date, "purchase_no": p.purchase_no, "supplier": p.supplier.name, "gstin": p.supplier.gstin, "bill_no": p.supplier_invoice_no,
                         "item": l.item.name, "qty": f"{_q(l.item, l.qty_base)} {l.item.display_unit}", "rate": l.rate_paise, "rate_unit": l.rate_unit,
                         "taxable": l.value_paise, "tax": l.tax_paise, "total": l.value_paise + l.tax_paise})
    return Report("purchase-register", "Purchase Register", _period(a, b), [Section("Purchases", [("date", "Date", "date"), ("purchase_no", "Purchase No", "text"), ("supplier", "Supplier", "text"),
                  ("gstin", "Supplier GSTIN", "text"), ("bill_no", "Supplier bill", "text"), ("item", "Item", "text"), ("qty", "Qty", "text"), ("rate", "Rate", "money"),
                  ("rate_unit", "Per", "text"), ("taxable", "Taxable", "money"), ("tax", "GST", "money"), ("total", "Total", "money")], rows, _tot(rows, ["taxable", "tax", "total"]))])


def stock_summary(db, a, b, kind=None):
    q = select(m.Item).order_by(m.Item.kind, m.Item.name)
    if kind:
        q = q.where(m.Item.kind == kind)
    rows = []
    for it in db.execute(q).scalars():
        ent = db.execute(select(m.StockLedger).where(m.StockLedger.item_id == it.id, m.StockLedger.entry_date <= b)).scalars().all()
        o = r = i = ad = 0
        ov = rv = iv = av = 0
        for e in ent:
            if e.movement_type == "OPENING" or e.entry_date < a:
                o += e.qty_delta; ov += e.value_delta_paise
            elif e.movement_type in inv.RECEIPT_TYPES:
                r += e.qty_delta; rv += e.value_delta_paise
            elif e.movement_type in inv.ISSUE_TYPES:
                i += -e.qty_delta; iv += -e.value_delta_paise
            else:
                ad += e.qty_delta; av += e.value_delta_paise
        rows.append({"item": it.name, "kind": it.kind, "unit": it.display_unit, "opening": _q(it, o), "receipts": _q(it, r), "issues": _q(it, i), "adjustments": _q(it, ad),
                     "closing": _q(it, o + r - i + ad), "closing_value": ov + rv - iv + av})
    return Report("stock-summary", "Stock Summary", _period(a, b), [Section("Stock roll-forward (opening + receipts - issues ± adjustments = closing)", [("item", "Item", "text"), ("kind", "Type", "text"),
                  ("unit", "Unit", "text"), ("opening", "Opening", "text"), ("receipts", "Receipts", "text"), ("issues", "Issues/Sales", "text"), ("adjustments", "Adjustments", "text"),
                  ("closing", "Closing", "text"), ("closing_value", "Closing value", "money")], rows, _tot(rows, ["closing_value"]))],
                  ["Value-only cost adjustments (overheads added to finished goods) change closing value but not quantity."])


def stock_ledger(db, a, b, item_id=None, kind=None):
    q = select(m.Item).order_by(m.Item.kind, m.Item.name)
    if item_id:
        q = q.where(m.Item.id == item_id)
    if kind:
        q = q.where(m.Item.kind == kind)
    sections = []
    for it in db.execute(q).scalars():
        ents = db.execute(select(m.StockLedger).where(m.StockLedger.item_id == it.id, m.StockLedger.entry_date <= b).order_by(m.StockLedger.entry_date, m.StockLedger.id)).scalars().all()
        run_q = run_v = 0
        rows = []
        for e in ents:
            run_q += e.qty_delta; run_v += e.value_delta_paise
            if e.entry_date >= a:
                rows.append({"id": e.id, "date": e.entry_date, "type": e.movement_type, "source": f"{e.source_type}#{e.source_id}", "batch": e.batch_no, "expiry": e.expiry_date,
                             "in_qty": _q(it, e.qty_delta) if e.qty_delta > 0 else "", "out_qty": _q(it, -e.qty_delta) if e.qty_delta < 0 else "", "balance": _q(it, run_q),
                             "value_delta": e.value_delta_paise, "balance_value": run_v, "narration": e.narration})
        if rows:
            sections.append(Section(f"{it.name} ({it.display_unit})", [("id", "#", "int"), ("date", "Date", "date"), ("type", "Movement", "text"), ("source", "Source doc", "text"), ("batch", "Batch", "text"),
                                    ("expiry", "Expiry", "date"), ("in_qty", "In", "text"), ("out_qty", "Out", "text"), ("balance", "Balance", "text"), ("value_delta", "Value ±", "money"),
                                    ("balance_value", "Balance value", "money"), ("narration", "Narration", "text")], rows))
    return Report("stock-ledger", "Stock Ledger", _period(a, b), sections)


def production_report(db, a, b):
    runs = db.execute(select(m.ProductionRun).where(m.ProductionRun.planned_date.between(a, b)).order_by(m.ProductionRun.id)).scalars().all()
    summ, lines = [], []
    for r in runs:
        v, c = prod.variance(db, r), prod.run_cost(db, r)
        y = v["yield"] or {}
        summ.append({"run_no": r.run_no, "product": r.product.name, "status": r.status, "batch": r.batch_no, "planned": r.planned_output, "good": r.good_output, "rejected": r.rejected_output,
                     "yield_var": (y.get("variance_pct") + "%") if y.get("variance_pct") else "", "yield_flag": "FLAG" if y.get("flagged") else "", "material": c["material_paise"],
                     "overhead": c["overhead_paise"], "cpp": c["cost_per_packet_paise"]})
        for l in v["lines"]:
            lines.append({"run_no": r.run_no, "item": l["name"], "unit": l["unit"], "planned": l["planned"]["qty"], "actual": l["actual"]["qty"], "diff": l["difference"]["qty"],
                          "var": (l["variance_pct"] + "%") if l["variance_pct"] else "n/a", "flag": ("FLAG " + (l["direction"] or "")).strip() if l["flagged"] else ""})
    return Report("production-report", "Production Report: Planned vs Actual", _period(a, b), [
        Section("Runs (yield & cost)", [("run_no", "Run", "text"), ("product", "Product", "text"), ("status", "Status", "text"), ("batch", "Batch", "text"), ("planned", "Planned packets", "int"),
                ("good", "Good packets", "int"), ("rejected", "Rejected", "int"), ("yield_var", "Yield var", "text"), ("yield_flag", "Yield flag", "text"), ("material", "Material cost", "money"),
                ("overhead", "Run overhead", "money"), ("cpp", "Cost/packet", "money")], summ),
        Section("Consumption variance by material", [("run_no", "Run", "text"), ("item", "Material", "text"), ("unit", "Unit", "text"), ("planned", "Planned", "text"), ("actual", "Actual", "text"),
                ("diff", "Difference", "text"), ("var", "Variance", "text"), ("flag", "Flag", "text")], lines)],
        [f"Variance flagged when |variance| exceeds {prod.tolerance_bp(db) / 100:.2f}% (setting)."])


def collections(db, a, b):
    rows = []
    for p in db.execute(select(m.Payment).where(m.Payment.payment_date.between(a, b)).order_by(m.Payment.payment_date, m.Payment.id)).scalars():
        rows.append({"date": p.payment_date, "receipt": p.receipt_no, "customer": p.customer.name, "mode": p.mode, "reference": p.reference,
                     "against": ", ".join(db.get(m.Invoice, x.invoice_id).invoice_no for x in p.allocations), "amount": p.amount_paise,
                     "unallocated": p.amount_paise - sum(x.amount_paise for x in p.allocations)})
    return Report("collections", "Payments & Collections", _period(a, b), [Section("Receipts", [("date", "Date", "date"), ("receipt", "Receipt", "text"), ("customer", "Customer", "text"),
                  ("mode", "Mode", "text"), ("reference", "Reference", "text"), ("against", "Against invoices", "text"), ("amount", "Amount", "money"), ("unallocated", "Unallocated (advance)", "money")],
                  rows, _tot(rows, ["amount", "unallocated"]))])


def outstanding(db, as_on):
    cust_rows, inv_rows = {}, []
    for i in db.execute(select(m.Invoice).where(m.Invoice.status == "ISSUED", m.Invoice.invoice_date <= as_on).order_by(m.Invoice.invoice_date)).scalars():
        o = pay.invoice_outstanding(db, i)
        if o <= 0:
            continue
        age = (as_on - i.invoice_date).days
        bucket = "b0_30" if age <= 30 else "b31_60" if age <= 60 else "b61_90" if age <= 90 else "b90p"
        r = cust_rows.setdefault(i.customer_id, {"customer": i.buyer_name, "b0_30": 0, "b31_60": 0, "b61_90": 0, "b90p": 0, "total": 0})
        r[bucket] += o; r["total"] += o
        inv_rows.append({"customer": i.buyer_name, "invoice_no": i.invoice_no, "date": i.invoice_date, "due_date": i.invoice_date.fromordinal(i.invoice_date.toordinal() + i.customer.credit_days),
                         "age_days": age, "billed": i.total_paise, "outstanding": o})
    rows = list(cust_rows.values())
    cols = [("customer", "Customer", "text"), ("b0_30", "0-30 days", "money"), ("b31_60", "31-60", "money"), ("b61_90", "61-90", "money"), ("b90p", "90+", "money"), ("total", "Total outstanding", "money")]
    return Report("outstanding", "Outstanding Receivables with Ageing", f"As on {as_on:%d-%b-%Y}", [
        Section("By customer", cols, rows, _tot(rows, ["b0_30", "b31_60", "b61_90", "b90p", "total"])),
        Section("Open invoices", [("customer", "Customer", "text"), ("invoice_no", "Invoice", "text"), ("date", "Invoice date", "date"), ("due_date", "Due date", "date"), ("age_days", "Age (days)", "int"),
                ("billed", "Invoice total", "money"), ("outstanding", "Outstanding", "money")], inv_rows, _tot(inv_rows, ["billed", "outstanding"]))],
        ["Ageing counted from invoice date. Unallocated advances are not netted here; see Collections report."])


def cost_per_packet(db, a, b):
    month = f"{a:%Y-%m}"
    d = costing.monthly_costing(db, month)
    return Report("cost-per-packet", "Cost per Packet & Margin", f"Month {month}", [
        Section("By product", [("product", "Product", "text"), ("good_output", "Good packets", "int"), ("material_paise", "Materials", "money"), ("run_overhead_paise", "Run overheads", "money"),
                ("allocated_monthly_paise", "Monthly pool share", "money"), ("total_cost_paise", "Total cost", "money"), ("cost_per_packet_paise", "Cost / packet", "money"),
                ("selling_price_paise", "Selling price", "money"), ("margin_paise", "Margin / packet", "money"), ("margin_pct", "Margin %", "text")], d["products"]),
        Section("By production run", [("run_no", "Run", "text"), ("product", "Product", "text"), ("batch_no", "Batch", "text"), ("good_output", "Good packets", "int"), ("material_paise", "Materials", "money"),
                ("run_overhead_paise", "Run overheads", "money"), ("allocated_monthly_paise", "Monthly pool share", "money"), ("total_cost_paise", "Total cost", "money"), ("cost_per_packet_paise", "Cost / packet", "money")], d["runs"])],
        [f"{k}: {v}" for k, v in d["method"].items()])


def batch_stock(db, a, b):
    rows = []
    for it in db.execute(select(m.Item).where(m.Item.kind == "FINISHED")).scalars():
        for lot in inv.lots(db, it.id):
            days = (lot["expiry_date"] - b).days if lot["expiry_date"] else None
            rows.append({"product": it.name, "batch": lot["batch_no"], "expiry": lot["expiry_date"], "days_to_expiry": days, "qty": lot["qty"]})
    return Report("batch-stock", "Finished Goods by Batch / Expiry", f"As on {b:%d-%b-%Y}", [Section("Lots (dispatch order = first expiry first out)", [("product", "Product", "text"),
                  ("batch", "Batch", "text"), ("expiry", "Expiry", "date"), ("days_to_expiry", "Days to expiry", "int"), ("qty", "Packets", "int")], rows)])


REPORTS = {"sales-register": sales_register, "customer-sales": customer_sales, "product-sales": product_sales, "gst-summary": gst_summary, "purchase-register": purchase_register,
           "stock-summary": stock_summary, "stock-ledger": stock_ledger, "production-report": production_report, "collections": collections, "cost-per-packet": cost_per_packet, "batch-stock": batch_stock}


def build(db: Session, key: str, a: date | None, b: date | None, **kw) -> Report:
    today = today_ist()
    if key == "outstanding":
        rep = outstanding(db, b or today)
    else:
        if key not in REPORTS:
            raise ValidationFailed(f"Unknown report '{key}'")
        if not a or not b:
            a, b = month_range(f"{today:%Y-%m}")
        if a > b:
            raise ValidationFailed("from_date must be on or before to_date")
        if (b - a).days > 800:
            raise ValidationFailed("Date range too large (max ~2 years)")
        fn = REPORTS[key]
        if key == "stock-summary":
            rep = fn(db, a, b, kw.get("kind"))
        elif key == "stock-ledger":
            rep = fn(db, a, b, kw.get("item_id"), kw.get("kind"))
        else:
            rep = fn(db, a, b)
    rep.company = company(db)
    return rep
