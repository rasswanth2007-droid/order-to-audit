from sqlalchemy import select
from sqlalchemy.orm import Session
from .. import models as m
from ..money import round_div
from ..util import month_range
from . import production as prod


def monthly_costing(db: Session, month: str) -> dict:
    """Cost per packet by product for a month.
    Materials: weighted-average issue cost from the ledger. Run overheads: entered per run.
    Monthly pool (rent, supervisor, etc.): allocated to runs in proportion to good packets produced in the month."""
    start, end = month_range(month)
    runs = db.execute(select(m.ProductionRun).where(m.ProductionRun.status == "COMPLETED", m.ProductionRun.mfg_date >= start,
                                                    m.ProductionRun.mfg_date <= end).order_by(m.ProductionRun.id)).scalars().all()
    pool = sum(o.amount_paise for o in db.execute(select(m.MonthlyOverhead).where(m.MonthlyOverhead.month == month)).scalars())
    total_good = sum(r.good_output for r in runs)
    run_rows, products = [], {}
    allocated_so_far = 0
    for idx, r in enumerate(runs):
        c = prod.run_cost(db, r)
        share = pool - allocated_so_far if idx == len(runs) - 1 else round_div(pool * r.good_output, total_good)  # last run takes the rounding remainder
        allocated_so_far += share
        total = c["total_paise"] + share
        cpp = round_div(total, r.good_output)
        price = r.product.selling_price_paise
        run_rows.append({"run_no": r.run_no, "product": r.product.name, "batch_no": r.batch_no, "good_output": r.good_output, "material_paise": c["material_paise"],
                         "run_overhead_paise": c["overhead_paise"], "allocated_monthly_paise": share, "total_cost_paise": total, "cost_per_packet_paise": cpp})
        p = products.setdefault(r.product_id, {"product": r.product.name, "price": price, "good": 0, "material": 0, "run_ovh": 0, "alloc": 0})
        p["good"] += r.good_output; p["material"] += c["material_paise"]; p["run_ovh"] += c["overhead_paise"]; p["alloc"] += share
    prod_rows = []
    for p in products.values():
        total = p["material"] + p["run_ovh"] + p["alloc"]
        cpp = round_div(total, p["good"])
        prod_rows.append({"product": p["product"], "good_output": p["good"], "material_paise": p["material"], "run_overhead_paise": p["run_ovh"],
                          "allocated_monthly_paise": p["alloc"], "total_cost_paise": total, "cost_per_packet_paise": cpp, "selling_price_paise": p["price"],
                          "margin_paise": (p["price"] - cpp) if p["price"] is not None else None,
                          "margin_pct": f"{(p['price'] - cpp) * 100 / p['price']:.2f}" if p["price"] else None})
    return {"month": month, "monthly_pool_paise": pool, "products": prod_rows, "runs": run_rows,
            "method": {"valuation": "Moving weighted-average cost", "run_overheads": "Entered per production run (labour, gas/power)",
                       "monthly_pool": "Allocated to runs by share of good packets produced in the month"}}
