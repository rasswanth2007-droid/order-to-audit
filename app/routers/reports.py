from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from .. import models as m
from ..db import get_db
from ..deps import require
from ..errors import ValidationFailed
from ..services import costing, inventory as inv, payments as pay, production as prod, reports as rpt
from ..services.exporters import to_csv, to_pdf, to_xlsx
from ..util import month_range, today_ist

router = APIRouter(tags=["reports"])
ALL = require("ADMIN", "ACCOUNTANT", "OWNER")
FLOOR_REPORTS = {"stock-summary", "stock-ledger", "production-report", "batch-stock"}
MEDIA = {"csv": "text/csv; charset=utf-8", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "pdf": "application/pdf"}


@router.get("/reports")
def catalogue(_: m.User = Depends(require("ADMIN", "ACCOUNTANT", "OWNER", "PRODUCTION"))):
    return {"reports": [*rpt.REPORTS.keys(), "outstanding"], "formats": ["json", "csv", "xlsx", "pdf"], "production_role_can_see": sorted(FLOOR_REPORTS)}


@router.get("/reports/{key}")
def report(key: str, from_date: date | None = None, to_date: date | None = None, format: str = Query("json", pattern="^(json|csv|xlsx|pdf)$"),
           item_id: int | None = None, kind: str | None = Query(None, pattern="^(RAW|PACKAGING|FINISHED)$"),
           user: m.User = Depends(require("ADMIN", "ACCOUNTANT", "OWNER", "PRODUCTION")), db: Session = Depends(get_db)):
    if user.role == "PRODUCTION" and key not in FLOOR_REPORTS:
        from ..errors import Forbidden
        raise Forbidden("Production role can only open stock and production reports")
    rep = rpt.build(db, key, from_date, to_date, item_id=item_id, kind=kind)
    if format == "json":
        return rep.to_json()
    body = {"csv": to_csv, "xlsx": to_xlsx, "pdf": to_pdf}[format](rep)
    return Response(body, media_type=MEDIA[format], headers={"Content-Disposition": f'attachment; filename="{key}.{format}"', "Cache-Control": "no-store"})


@router.get("/dashboard")
def dashboard(user: m.User = Depends(require("OWNER", "ADMIN", "ACCOUNTANT")), db: Session = Depends(get_db)):
    today = today_ist()
    orders_today = db.execute(select(m.Order).where(func.date(m.Order.created_at) == today)).scalars().all()
    pending = db.execute(select(func.count()).select_from(m.Order).where(m.Order.status == "SUBMITTED")).scalar_one()
    stock = inv.summary(db)
    low = [s for s in stock if s["low_stock"] and s["kind"] != "FINISHED"]
    alerts = []
    cutoff = today - timedelta(days=30)
    for r in db.execute(select(m.ProductionRun).where(m.ProductionRun.status == "COMPLETED", m.ProductionRun.mfg_date >= cutoff).order_by(m.ProductionRun.id.desc())).scalars():
        v = prod.variance(db, r)
        for l in v["lines"]:
            if l["flagged"]:
                alerts.append({"run_id": r.id, "run_no": r.run_no, "what": l["name"], "variance_pct": l["variance_pct"], "direction": l["direction"]})
        if v["yield"] and v["yield"]["flagged"]:
            alerts.append({"run_id": r.id, "run_no": r.run_no, "what": "Yield", "variance_pct": v["yield"]["variance_pct"], "direction": v["yield"]["direction"]})
    outst_rows = rpt.outstanding(db, today).sections
    cust = outst_rows[0]
    overdue = sum(r["outstanding"] for r in outst_rows[1].rows if r["due_date"] < today)
    cost = costing.monthly_costing(db, f"{today:%Y-%m}")
    return {"as_on": today, "orders_today": {"count": len(orders_today), "value_paise": sum(l.qty * l.price_paise for o in orders_today for l in o.lines)}, "pending_approvals": pending,
            "stock": stock, "low_stock": low, "variance_alerts": alerts[:20], "cost_per_packet": cost["products"],
            "outstanding": {"total_paise": cust.totals["total"] if cust.totals else 0, "overdue_paise": overdue, "top_debtors": sorted(cust.rows, key=lambda r: -r["total"])[:5]}}


@router.get("/audit")
def audit_log(entity: str | None = None, entity_id: str | None = None, username: str | None = None, limit: int = Query(100, le=500), offset: int = Query(0, ge=0),
              _: m.User = Depends(require("ADMIN", "ACCOUNTANT", "OWNER")), db: Session = Depends(get_db)):
    q = select(m.AuditLog)
    for col, v in ((m.AuditLog.entity, entity), (m.AuditLog.entity_id, entity_id), (m.AuditLog.username, username)):
        if v:
            q = q.where(col == v)
    total = db.execute(select(func.count()).select_from(q.subquery())).scalar_one()
    rows = db.execute(q.order_by(m.AuditLog.id.desc()).limit(limit).offset(offset)).scalars().all()
    return {"total": total, "items": [{"id": a.id, "ts": a.ts, "username": a.username, "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "before": a.before_json, "after": a.after_json} for a in rows]}
