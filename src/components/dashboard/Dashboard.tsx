import { useCallback, useEffect, useState } from "react";
import { Badge, Button, ErrorBanner, Icon, LoadingState, PageHeader, Stat } from "../ui";
import { api } from "@/services/api";
import { formatDate, formatMoney } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/utils/i18n";
import type { View } from "@/types";

type DashboardRes = {
  as_on: string;
  orders_today: { count: number; value_paise: number };
  pending_approvals: number;
  stock: Array<{
    item_id: number;
    name: string;
    kind: string;
    qty: string;
    unit: string;
    reorder_level: string;
    low_stock: boolean;
  }>;
  low_stock: Array<{
    item_id: number;
    name: string;
    qty: string;
    unit: string;
    reorder_level: string;
  }>;
  variance_alerts: Array<{
    run_id: number;
    run_no: string;
    what: string;
    variance_pct: string | null;
    direction: string | null;
  }>;
  cost_per_packet: Array<{
    product: string;
    cost_per_packet_paise: number | null;
    selling_price_paise: number | null;
    margin_pct: string | null;
  }>;
  outstanding: {
    total_paise: number;
    overdue_paise: number;
    top_debtors: Array<{ customer: string; total: number }>;
  };
};

export function Dashboard({
  onOrders,
  onNavigate,
}: {
  onOrders: () => void;
  onNavigate?: (v: View) => void;
}) {
  const { user } = useAuth();
  const tr = useT();
  const [data, setData] = useState<DashboardRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<DashboardRes>("/dashboard");
      setData(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const finishedItems = (data?.stock || []).filter((s) => s.kind === "FINISHED");
  const finishedTotal = finishedItems.reduce((acc, s) => acc + Number(s.qty || 0), 0);
  const attentionCount =
    (data?.variance_alerts.length || 0) +
    (data?.low_stock.length || 0) +
    (data?.pending_approvals ? 1 : 0);

  return (
    <div>
      <PageHeader
        eyebrow="OVERVIEW"
        title={`Good day, ${user?.full_name?.split(" ")[0] || "Team"}`}
        description={
          data ? `Here's what needs attention as on ${formatDate(data.as_on)}.` : "Loading summary…"
        }
        action={
          <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <ErrorBanner error={error} onRetry={load} />
      {loading && !data && <LoadingState label="Loading dashboard…" />}

      {data && (
        <>
          <div className="stats dashboard-stats">
            <Stat
              label="Orders today"
              value={String(data.orders_today.count)}
              note={`${formatMoney(data.orders_today.value_paise)} total value`}
            />
            <button className="stat actionable" onClick={onOrders}>
              <span>Pending approvals</span>
              <strong>{data.pending_approvals}</strong>
              <small>Review orders →</small>
            </button>
            <Stat
              label="Outstanding"
              value={formatMoney(data.outstanding.total_paise)}
              note={`${formatMoney(data.outstanding.overdue_paise)} overdue`}
            />
            <Stat
              label="Finished stock"
              value={finishedTotal.toLocaleString("en-IN")}
              note={`Packets across ${finishedItems.length} products`}
            />
          </div>

          <div className="dashboard-grid">
            <section className="card">
              <div className="section-heading">
                <div>
                  <h2>{tr("Needs attention")}</h2>
                  <p>Items requiring action</p>
                </div>
                <Badge tone={attentionCount > 0 ? "warning" : "success"}>
                  {attentionCount} ITEMS
                </Badge>
              </div>
              <div className="attention-list">
                {data.variance_alerts.slice(0, 4).map((a, idx) => (
                  <button key={`${a.run_id}-${idx}`} onClick={() => onNavigate?.("run")}>
                    <span className="attention-icon warning">
                      <Icon name="warning" />
                    </span>
                    <span>
                      <strong>{a.what} variance</strong>
                      <small>{a.run_no}</small>
                    </span>
                    <Badge tone="warning">
                      {a.variance_pct ? `${a.variance_pct}%` : a.direction || "FLAG"}
                    </Badge>
                    <Icon name="chevron" />
                  </button>
                ))}
                {data.low_stock.slice(0, 4).map((l) => (
                  <button key={l.item_id} onClick={() => onNavigate?.("stock")}>
                    <span className="attention-icon danger">
                      <Icon name="box" />
                    </span>
                    <span>
                      <strong>{l.name} is low</strong>
                      <small>
                        {l.qty} {l.unit} on hand · reorder at {l.reorder_level} {l.unit}
                      </small>
                    </span>
                    <Badge tone="danger">LOW STOCK</Badge>
                    <Icon name="chevron" />
                  </button>
                ))}
                {data.pending_approvals > 0 && (
                  <button onClick={onOrders}>
                    <span className="attention-icon info">
                      <Icon name="bag" />
                    </span>
                    <span>
                      <strong>{data.pending_approvals} orders awaiting approval</strong>
                      <small>Open orders inbox to review</small>
                    </span>
                    <Icon name="chevron" />
                  </button>
                )}
                {attentionCount === 0 && (
                  <p className="text-sm text-[var(--muted)] py-4">
                    Everything looks healthy right now.
                  </p>
                )}
              </div>
            </section>

            <section className="card">
              <div className="section-heading">
                <div>
                  <h2>{tr("Top debtors")}</h2>
                  <p>Highest open balances</p>
                </div>
                {onNavigate && (
                  <button className="text-link" onClick={() => onNavigate("reports")}>
                    View reports
                  </button>
                )}
              </div>
              <div className="debtor-list">
                {data.outstanding.top_debtors.length === 0 ? (
                  <p className="text-sm text-[var(--muted)] py-4">No open receivables.</p>
                ) : (
                  data.outstanding.top_debtors.map((d, i) => (
                    <div key={d.customer}>
                      <span>{i + 1}</span>
                      <strong>{d.customer}</strong>
                      <b>{formatMoney(d.total)}</b>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <h2 className="section-title">{tr("Cost & margin by product")}</h2>
          {data.cost_per_packet.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              No completed production runs this month yet.
            </p>
          ) : (
            <div className="cost-products">
              {data.cost_per_packet.map((p) => (
                <div className="card" key={p.product}>
                  <span>{p.product}</span>
                  <strong>
                    {p.cost_per_packet_paise !== null ? formatMoney(p.cost_per_packet_paise) : "—"}
                    <small> / packet</small>
                  </strong>
                  <Badge tone={Number(p.margin_pct || 0) >= 0 ? "success" : "danger"}>
                    {p.margin_pct ? `${p.margin_pct}% margin` : "No price"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
