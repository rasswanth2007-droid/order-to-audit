import io
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from .. import models as m
from ..money import amount_in_words, fmt_inr
from ..util import STATE_NAMES


def render_invoice(inv: m.Invoice, co: dict, credit_note: m.CreditNote | None = None) -> bytes:
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm, topMargin=12 * mm, bottomMargin=12 * mm, title=inv.invoice_no)
    st = getSampleStyleSheet()
    n = st["BodyText"].clone("n", fontSize=8.5, leading=10.5)
    b = st["BodyText"].clone("b", fontSize=8.5, leading=10.5, fontName="Helvetica-Bold")
    esc = lambda s: (s or "").replace("&", "&amp;").replace("<", "&lt;")
    title = "TAX INVOICE" if inv.status == "ISSUED" else "TAX INVOICE (CANCELLED)"
    els = [Paragraph(f"<b>{title}</b>", st["Title"])]
    seller = f"<b>{esc(co['name'])}</b><br/>{esc(co['address'])}<br/>GSTIN: {co['gstin']} | State: {co['state_name']} ({co['state_code']})<br/>{esc(co.get('phone'))} {esc(co.get('email'))}"
    buyer = (f"<b>Bill to / Ship to</b><br/><b>{esc(inv.buyer_name)}</b><br/>{esc(inv.buyer_address)}<br/>GSTIN: {inv.buyer_gstin or 'Unregistered'}<br/>"
             f"Place of supply: {inv.place_of_supply} - {STATE_NAMES.get(inv.place_of_supply, '')}")
    meta = f"<b>Invoice No:</b> {inv.invoice_no}<br/><b>Date:</b> {inv.invoice_date:%d-%m-%Y}<br/><b>Order:</b> {inv.order.order_no}<br/><b>Supply:</b> {'Intra-state (CGST+SGST)' if inv.supply_type == 'INTRA' else 'Inter-state (IGST)'}"
    head = Table([[Paragraph(seller, n), Paragraph(meta, n)], [Paragraph(buyer, n), ""]], colWidths=[110 * mm, 72 * mm])
    head.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.5, colors.black), ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.grey), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("SPAN", (1, 0), (1, 1))]))
    els += [head, Spacer(1, 6)]
    intra = inv.supply_type == "INTRA"
    hdr = ["#", "Description", "HSN", "Qty", "Rate", "Taxable"] + (["CGST", "SGST"] if intra else ["IGST"]) + ["Amount"]
    data = [[Paragraph(f"<b>{h}</b>", n) for h in hdr]]
    for i, l in enumerate(inv.lines, 1):
        tax_cols = ([f"{l.gst_rate_bp / 200:g}% {fmt_inr(l.cgst_paise)}", f"{l.gst_rate_bp / 200:g}% {fmt_inr(l.sgst_paise)}"] if intra else [f"{l.gst_rate_bp / 100:g}% {fmt_inr(l.igst_paise)}"])
        data.append([str(i), Paragraph(esc(l.description), n), l.hsn_code or "", f"{l.qty} PKT", fmt_inr(l.price_paise), fmt_inr(l.taxable_paise), *tax_cols,
                     fmt_inr(l.taxable_paise + l.cgst_paise + l.sgst_paise + l.igst_paise)])
    ncol = len(hdr)
    data.append(["", "Total", "", "", "", fmt_inr(inv.taxable_paise), *([fmt_inr(inv.cgst_paise), fmt_inr(inv.sgst_paise)] if intra else [fmt_inr(inv.igst_paise)]),
                 fmt_inr(inv.taxable_paise + inv.cgst_paise + inv.sgst_paise + inv.igst_paise)])
    t = Table(data, repeatRows=1)
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8EEF6")), ("FONTSIZE", (0, 1), (-1, -1), 8),
                           ("ALIGN", (3, 1), (-1, -1), "RIGHT"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold")]))
    els.append(t)
    tot = [["Taxable value", fmt_inr(inv.taxable_paise)]]
    if intra:
        tot += [["CGST", fmt_inr(inv.cgst_paise)], ["SGST", fmt_inr(inv.sgst_paise)]]
    else:
        tot += [["IGST", fmt_inr(inv.igst_paise)]]
    tot += [["Round off", fmt_inr(inv.round_off_paise)], ["Invoice total (INR)", fmt_inr(inv.total_paise)]]
    tt = Table(tot, colWidths=[40 * mm, 30 * mm], hAlign="RIGHT")
    tt.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.25, colors.grey), ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold")]))
    els += [Spacer(1, 6), tt, Spacer(1, 6), Paragraph(f"<b>Amount in words:</b> {amount_in_words(inv.total_paise)}", n), Spacer(1, 6),
            Paragraph(f"<b>Bank:</b> {esc(co.get('bank'))}", n), Paragraph("Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. "
                                                                            "Goods once sold will not be taken back except against a credit note. Subject to Tiruchirappalli jurisdiction.", n)]
    if inv.status == "CANCELLED" and credit_note:
        els += [Spacer(1, 6), Paragraph(f"<b>CANCELLED</b> by credit note {credit_note.cn_no} dated {credit_note.cn_date:%d-%m-%Y}. Reason: {esc(credit_note.reason)}", b)]
    els += [Spacer(1, 14), Paragraph(f"For {esc(co['name'])}<br/><br/>Authorised signatory", n), Paragraph("This is a computer generated invoice.", n)]
    doc.build(els)
    return out.getvalue()
