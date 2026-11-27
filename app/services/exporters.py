"""One generic Report object -> JSON / CSV / XLSX / PDF so every report is exportable the same way."""
import csv
import io
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from ..money import fmt_inr, rupees_str


@dataclass
class Section:
    title: str
    columns: list[tuple[str, str, str]]  # (key, label, kind) kind: text|int|money|date|pct|qty
    rows: list[dict]
    totals: dict | None = None


@dataclass
class Report:
    key: str
    title: str
    period: str
    sections: list[Section] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    company: dict | None = None
    classification: str = "CONFIDENTIAL DOCUMENT"

    def to_json(self) -> dict:
        return {
            "key": self.key,
            "title": self.title,
            "period": self.period,
            "classification": self.classification,
            "company": self.company,
            "notes": self.notes,
            "sections": [
                {
                    "title": s.title,
                    "columns": [{"key": k, "label": l, "kind": t} for k, l, t in s.columns],
                    "rows": s.rows,
                    "totals": s.totals,
                }
                for s in self.sections
            ],
        }


def _company_lines(rep: Report) -> tuple[str, str]:
    co = rep.company or {}
    name = co.get("name") or "Annam Foods"
    parts = []
    if co.get("gstin"):
        parts.append(f"GSTIN: {co['gstin']}")
    if co.get("address"):
        parts.append(co["address"])
    if co.get("phone"):
        parts.append(f"Ph: {co['phone']}")
    if co.get("email"):
        parts.append(co["email"])
    return name, " | ".join(parts)


def _text(v, kind):
    if v is None:
        return ""
    if kind == "money":
        return rupees_str(int(v))
    if isinstance(v, (date, datetime)):
        return v.isoformat()[:10] if kind == "date" else v.isoformat(sep=" ", timespec="seconds")
    return str(v)


def to_csv(rep: Report) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    co_name, co_details = _company_lines(rep)
    w.writerow([co_name, rep.classification])
    if co_details:
        w.writerow([co_details])
    w.writerow([rep.title, rep.period])
    for s in rep.sections:
        w.writerow([])
        w.writerow([s.title])
        w.writerow([l for _, l, _ in s.columns])
        for r in s.rows:
            w.writerow([_safe(_text(r.get(k), t)) for k, _, t in s.columns])
        if s.totals:
            w.writerow([_text(s.totals.get(k), t) if k in s.totals else ("TOTAL" if i == 0 else "") for i, (k, _, t) in enumerate(s.columns)])
    return buf.getvalue().encode("utf-8-sig")


def _safe(v: str) -> str:  # neutralise spreadsheet formula injection
    return "'" + v if v[:1] in ("=", "+", "-", "@") and not _is_number(v) else v


def _is_number(v: str) -> bool:
    try:
        Decimal(v)
        return True
    except Exception:
        return False


def to_xlsx(rep: Report) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    co_name, co_details = _company_lines(rep)
    for i, s in enumerate(rep.sections):
        ws = wb.create_sheet((f"{i + 1}-{s.title}")[:31].replace("/", "-"))
        ws.append([co_name, rep.classification])
        ws["A1"].font = Font(bold=True, size=12, color="0F5C5C")
        ws["B1"].font = Font(bold=True, size=10, color="B3261E")
        ws.append([co_details or ""])
        ws["A2"].font = Font(size=9, color="555555")
        ws.append([rep.title, rep.period])
        ws["A3"].font = Font(bold=True, size=13)
        ws.append([l for _, l, _ in s.columns])
        header_row = 4
        for c in ws[header_row]:
            c.font = Font(bold=True, color="FFFFFF")
            c.fill = PatternFill("solid", fgColor="1F3A5F")
        for r in s.rows:
            ws.append([_cell(r.get(k), t) for k, _, t in s.columns])
        if s.totals:
            ws.append([_cell(s.totals.get(k), t) if k in s.totals else ("TOTAL" if j == 0 else None) for j, (k, _, t) in enumerate(s.columns)])
            for c in ws[ws.max_row]:
                c.font = Font(bold=True)
        for j, (_, _, t) in enumerate(s.columns, start=1):
            ws.column_dimensions[ws.cell(row=header_row, column=j).column_letter].width = 16 if t != "text" else 28
            if t == "money":
                for row in ws.iter_rows(min_row=header_row + 1, min_col=j, max_col=j):
                    row[0].number_format = '#,##0.00'
                    row[0].alignment = Alignment(horizontal="right")
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def _cell(v, kind):
    if v is None:
        return None
    if kind == "money":
        return Decimal(int(v)) / 100
    if kind == "int":
        return int(v)
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return v
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "@") else s


def to_pdf(rep: Report) -> bytes:
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=landscape(A4), leftMargin=24, rightMargin=24, topMargin=28, bottomMargin=28, title=rep.title)
    st = getSampleStyleSheet()
    cell = st["BodyText"].clone("cell", fontSize=7, leading=8.5)
    co_name, co_details = _company_lines(rep)
    esc = lambda txt: str(txt).replace("&", "&amp;").replace("<", "&lt;")
    header_tbl = Table(
        [[Paragraph(f"<b>{esc(co_name)}</b><br/><font size='8' color='#555555'>{esc(co_details)}</font>", st["Normal"]),
          Paragraph(f"<font color='#B3261E'><b>{esc(rep.classification)}</b></font>", st["Normal"])]],
        colWidths=[580, 200],
    )
    header_tbl.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                                    ("LINEBELOW", (0, 0), (-1, 0), 0.75, colors.HexColor("#0F5C5C")),
                                    ("BOTTOMPADDING", (0, 0), (-1, 0), 6)]))
    els = [header_tbl, Spacer(1, 8), Paragraph(rep.title, st["Title"]), Paragraph(rep.period, st["Normal"]), Spacer(1, 8)]
    for n in rep.notes:
        els.append(Paragraph(n, cell))
    for s in rep.sections:
        els += [Spacer(1, 10), Paragraph(s.title, st["Heading3"])]
        data = [[Paragraph(f"<b>{l}</b>", cell) for _, l, _ in s.columns]]
        for r in s.rows:
            data.append([Paragraph(_pdf(r.get(k), t), cell) for k, _, t in s.columns])
        if s.totals:
            data.append([Paragraph(f"<b>{_pdf(s.totals.get(k), t) if k in s.totals else ('TOTAL' if i == 0 else '')}</b>", cell) for i, (k, _, t) in enumerate(s.columns)])
        if len(data) == 1:
            els.append(Paragraph("No data for this period.", cell))
            continue
        tbl = Table(data, repeatRows=1)
        tbl.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCE6F2")), ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                                 ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        els.append(tbl)
    els.append(Spacer(1, 10))
    els.append(Paragraph(f"<font size='7' color='#777777'>{esc(rep.classification)} — {esc(co_name)}</font>", cell))
    doc.build(els)
    return out.getvalue()


def _pdf(v, kind):
    if v is None:
        return ""
    if kind == "money":
        return fmt_inr(int(v))
    return _text(v, kind).replace("&", "&amp;").replace("<", "&lt;")
