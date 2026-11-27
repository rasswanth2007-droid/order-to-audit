import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
  PageHeader,
  Stat,
} from "../ui";
import { api } from "@/services/api";
import { formatDate, formatMoney, rupeesToPaise, todayISO } from "@/utils/format";
import { statusTone } from "@/utils/helpers";
import { useAuth } from "@/context/AuthContext";

type RunSummary = {
  id: number;
  run_no: string;
  product_id: number;
  product: string;
  status: string;
  batches: string;
  planned_output: number;
  good_output: number | null;
  planned_date: string;
  mfg_date: string | null;
  flag_count?: number;
};

type RunDetail = RunSummary & {
  rejected_output: number | null;
  batch_no: string | null;
  expiry_date: string | null;
  bom_version: number;
  notes: string | null;
  plan: Array<{ item_id: number; name: string; qty: string; unit: string }>;
  variance: {
    tolerance_pct: string;
    flag_count: number;
    lines: Array<{
      item_id: number;
      name: string;
      kind: string;
      unit: string;
      planned: { qty: string; unit: string };
      actual: { qty: string; unit: string };
      variance_pct: string | null;
      flagged: boolean;
      direction: string | null;
    }>;
    yield: {
      planned: number;
      actual: number;
      rejected: number;
      variance_pct: string | null;
      flagged: boolean;
      direction: string | null;
    } | null;
  };
  cost: {
    material_paise: number;
    overhead_paise: number;
    total_paise: number;
    good_output: number;
    cost_per_packet_paise: number | null;
    selling_price_paise: number | null;
    margin_pct: string | null;
  };
  overheads: Array<{
    id: number;
    category: string;
    amount_paise: number;
    note: string | null;
  }>;
};

type ItemOption = {
  id: number;
  name: string;
  kind: string;
  display_unit: string;
};

type BomOption = {
  product_id: number;
  product: string;
  yield_qty: number;
  lines: Array<{ item_id: number; name: string; unit: string }>;
};

type WasteDraft = { item_id: string; qty: string; unit: string; reason: string };

function RunDetailView({ runId, onBack }: { runId: number; onBack: () => void }) {
  const { role, notify } = useAuth();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [overheadOpen, setOverheadOpen] = useState(false);
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);

  const [issueQtys, setIssueQtys] = useState<Record<number, string>>({});
  const [goodOutput, setGoodOutput] = useState("");
  const [rejectedOutput, setRejectedOutput] = useState("0");
  const [pkgQtys, setPkgQtys] = useState<Record<number, string>>({});
  const [wastage, setWastage] = useState<WasteDraft[]>([]);
  const [mfgDate, setMfgDate] = useState(todayISO());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<RunDetail>(`/production/runs/${runId}`);
      setRun(res.data);
      const iq: Record<number, string> = {};
      const pq: Record<number, string> = {};
      for (const p of res.data.plan) {
        iq[p.item_id] = p.qty;
        pq[p.item_id] = p.qty;
      }
      setIssueQtys(iq);
      setPkgQtys(pq);
      setGoodOutput(String(res.data.planned_output));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const canWrite = role === "ADMIN" || role === "PRODUCTION";

  async function handleIssue(e: FormEvent) {
    e.preventDefault();
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const rawLines = run.variance.lines.filter((l) => l.kind === "RAW");
      const targetLines = rawLines.length > 0 ? rawLines : run.variance.lines;
      const lines = targetLines
        .map((l) => ({
          item_id: l.item_id,
          qty: Number(issueQtys[l.item_id] || 0),
          unit: l.unit,
        }))
        .filter((l) => l.qty > 0);
      await api(`/production/runs/${run.id}/issue`, {
        method: "POST",
        body: { lines, issue_date: todayISO() },
      });
      notify("Materials issued to production");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function doComplete() {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const pkgLines = run.variance.lines
        .filter((l) => l.kind === "PACKAGING")
        .map((l) => ({
          item_id: l.item_id,
          qty: Number(pkgQtys[l.item_id] || 0),
          unit: l.unit,
        }))
        .filter((l) => l.qty > 0);

      const wasteLines = wastage
        .filter((w) => w.item_id && Number(w.qty) > 0)
        .map((w) => ({
          item_id: Number(w.item_id),
          qty: Number(w.qty),
          unit: w.unit,
          reason: w.reason.trim() || null,
        }));

      await api(`/production/runs/${run.id}/complete`, {
        method: "POST",
        body: {
          good_output: Number(goodOutput),
          rejected_output: Number(rejectedOutput || 0),
          packaging_used: pkgLines,
          wastage: wasteLines,
          mfg_date: mfgDate,
        },
      });
      setConfirmCompleteOpen(false);
      notify("Production run completed");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddOverhead(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!run) return;
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/production/runs/${run.id}/overheads`, {
        method: "POST",
        body: {
          category: String(fd.get("category")),
          amount_paise: rupeesToPaise(String(fd.get("amount"))),
          note: String(fd.get("note") || "").trim() || null,
        },
      });
      setOverheadOpen(false);
      notify("Overhead added");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !run) return <LoadingState label="Loading production run…" />;
  if (!run) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          ‹ All production runs
        </button>
        <ErrorBanner error={error} onRetry={load} />
      </div>
    );
  }

  const step = run.status === "PLANNED" ? 1 : run.status === "ISSUED" ? 2 : 3;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ‹ All production runs
      </button>
      <PageHeader
        eyebrow="PRODUCTION"
        title={`Run ${run.run_no}`}
        description={`${run.product} · ${run.batches} batch(es) · Planned ${formatDate(run.planned_date)}`}
        action={
          <div className="header-actions">
            <Badge tone={statusTone(run.status)}>{run.status}</Badge>
            {canWrite && (
              <Button variant="secondary" onClick={() => setOverheadOpen(true)}>
                Add overhead
              </Button>
            )}
          </div>
        }
      />
      <ErrorBanner error={error} onRetry={load} />

      <div className="run-steps" aria-label="Production progress">
        {["Issue materials", "Record output", "Costs & summary"].map((label, i) => (
          <div className={step >= i + 1 ? "active" : ""} key={label}>
            <span>{step > i + 1 ? <Icon name="check" /> : i + 1}</span>
            <div>
              <small>STEP {i + 1}</small>
              <strong>{label}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="run-grid">
        <section className="card run-form">
          {step === 1 && (
            <form onSubmit={handleIssue}>
              <div className="section-heading mb-4">
                <div>
                  <p className="eyebrow">STEP 1 OF 3</p>
                  <h2>Issue raw materials</h2>
                  <p>Confirm actual quantities issued from stock.</p>
                </div>
              </div>
              <div className="space-y-3">
                {run.variance.lines
                  .filter((l) => l.kind === "RAW")
                  .map((l) => (
                    <div
                      key={l.item_id}
                      className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-3"
                    >
                      <div>
                        <strong>{l.name}</strong>
                        <div className="text-xs text-[var(--muted)]">
                          Planned: {l.planned.qty} {l.planned.unit}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          className="w-28 text-right"
                          inputMode="decimal"
                          value={issueQtys[l.item_id] ?? l.planned.qty}
                          onChange={(e) =>
                            setIssueQtys((p) => ({ ...p, [l.item_id]: e.target.value }))
                          }
                        />
                        <span className="text-sm text-[var(--muted)] w-12">{l.unit}</span>
                      </div>
                    </div>
                  ))}
              </div>
              <div className="mt-5 flex justify-end">
                <Button type="submit" disabled={busy || !canWrite}>
                  {busy ? "Issuing…" : "Issue materials"}
                </Button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setConfirmCompleteOpen(true);
              }}
            >
              <div className="section-heading mb-4">
                <div>
                  <p className="eyebrow">STEP 2 OF 3</p>
                  <h2>Record finished output</h2>
                  <p>Enter good packets produced, rejected packets, packaging used, and wastage.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <label>
                  <span>
                    Good output (packets) <b>*</b>
                  </span>
                  <input
                    required
                    type="number"
                    min={1}
                    value={goodOutput}
                    onChange={(e) => setGoodOutput(e.target.value)}
                  />
                </label>
                <label>
                  <span>Rejected (packets)</span>
                  <input
                    type="number"
                    min={0}
                    value={rejectedOutput}
                    onChange={(e) => setRejectedOutput(e.target.value)}
                  />
                </label>
                <label>
                  <span>Mfg date</span>
                  <input type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} />
                </label>
              </div>
              {run.variance.lines.some((l) => l.kind === "PACKAGING") && (
                <div className="mt-4 space-y-3">
                  <p className="font-semibold text-sm">Packaging used</p>
                  {run.variance.lines
                    .filter((l) => l.kind === "PACKAGING")
                    .map((l) => (
                      <div
                        key={l.item_id}
                        className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-3"
                      >
                        <div>
                          <strong>{l.name}</strong>
                          <div className="text-xs text-[var(--muted)]">
                            Planned: {l.planned.qty} {l.planned.unit}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            className="w-28 text-right"
                            inputMode="decimal"
                            value={pkgQtys[l.item_id] ?? l.planned.qty}
                            onChange={(e) =>
                              setPkgQtys((p) => ({ ...p, [l.item_id]: e.target.value }))
                            }
                          />
                          <span className="text-sm text-[var(--muted)] w-12">{l.unit}</span>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              <div className="mt-5 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">Wastage (optional)</p>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setWastage((p) => [...p, { item_id: "", qty: "", unit: "pcs", reason: "" }])
                    }
                  >
                    + Add wastage
                  </Button>
                </div>
                {wastage.map((w, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      className="col-span-5"
                      value={w.item_id}
                      onChange={(e) => {
                        const ln = run.variance.lines.find(
                          (l) => String(l.item_id) === e.target.value,
                        );
                        setWastage((prev) =>
                          prev.map((r, i) =>
                            i === idx
                              ? { ...r, item_id: e.target.value, unit: ln?.unit || r.unit }
                              : r,
                          ),
                        );
                      }}
                    >
                      <option value="">Select material…</option>
                      {run.variance.lines.map((l) => (
                        <option key={l.item_id} value={l.item_id}>
                          {l.name} ({l.unit})
                        </option>
                      ))}
                    </select>
                    <input
                      className="col-span-2"
                      placeholder="Qty"
                      inputMode="decimal"
                      value={w.qty}
                      onChange={(e) =>
                        setWastage((p) =>
                          p.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)),
                        )
                      }
                    />
                    <input
                      className="col-span-4"
                      placeholder="Reason"
                      value={w.reason}
                      onChange={(e) =>
                        setWastage((p) =>
                          p.map((r, i) => (i === idx ? { ...r, reason: e.target.value } : r)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="col-span-1 text-[var(--danger)]"
                      aria-label="Remove wastage row"
                      onClick={() => setWastage((p) => p.filter((_, i) => i !== idx))}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex justify-end">
                <Button type="submit" disabled={busy || !canWrite}>
                  Complete run
                </Button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div>
              <div className="section-heading mb-4">
                <div>
                  <p className="eyebrow">COMPLETED</p>
                  <h2>Batch {run.batch_no || run.run_no}</h2>
                  <p>
                    Manufactured {formatDate(run.mfg_date)} · Expiry {formatDate(run.expiry_date)}
                  </p>
                </div>
                <Badge tone="success">COMPLETED</Badge>
              </div>
              <div className="stats">
                <Stat label="Good output" value={`${run.good_output ?? 0} pkts`} />
                <Stat label="Rejected" value={`${run.rejected_output ?? 0} pkts`} />
                <Stat
                  label="Cost / packet"
                  value={formatMoney(run.cost.cost_per_packet_paise)}
                  note={run.cost.margin_pct ? `${run.cost.margin_pct}% margin` : undefined}
                />
              </div>
            </div>
          )}
        </section>

        <aside className="run-side">
          <div className="card variance">
            <div className="section-heading">
              <div>
                <h2>Planned vs actual</h2>
                <p>Flagged beyond ±{run.variance.tolerance_pct}%</p>
              </div>
              <Icon name="trend" />
            </div>
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="number">Planned</th>
                  <th className="number">Actual</th>
                  <th className="number">Var</th>
                </tr>
              </thead>
              <tbody>
                {run.variance.lines.map((l) => (
                  <tr key={l.item_id}>
                    <td>{l.name}</td>
                    <td className="number">
                      {l.planned.qty} {l.planned.unit}
                    </td>
                    <td className="number">
                      {l.actual.qty} {l.actual.unit}
                    </td>
                    <td className="number">
                      {l.flagged ? (
                        <Badge tone="warning">
                          {l.direction === "ADVERSE" ? "▲" : "▼"} {l.variance_pct}%
                        </Badge>
                      ) : (
                        <span className="muted">{l.variance_pct ?? "0.00"}%</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {run.variance.yield && (
              <div className="yield-row">
                <div>
                  <span>Yield</span>
                  <strong>{run.variance.yield.actual} packet</strong>
                  <small>
                    Planned {run.variance.yield.planned} · Rejected {run.variance.yield.rejected}
                  </small>
                </div>
                {run.variance.yield.flagged && (
                  <Badge tone="warning">
                    {run.variance.yield.variance_pct}% {run.variance.yield.direction}
                  </Badge>
                )}
              </div>
            )}
          </div>

          <div className="card cost-card p-5">
            <div className="section-heading mb-3">
              <h2>Run cost</h2>
              <Badge>SERVER CALCULATED</Badge>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Materials</span>
                <strong>{formatMoney(run.cost.material_paise)}</strong>
              </div>
              <div className="flex justify-between">
                <span>Overheads ({run.overheads.length})</span>
                <strong>{formatMoney(run.cost.overhead_paise)}</strong>
              </div>
              <div className="flex justify-between border-t border-[var(--border)] pt-2 font-semibold">
                <span>Total batch cost</span>
                <strong>{formatMoney(run.cost.total_paise)}</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {confirmCompleteOpen && (
        <Dialog title="Complete production run?" onClose={() => setConfirmCompleteOpen(false)}>
          <p className="text-sm text-[var(--muted)] mb-4">
            This updates raw-material and finished-goods stock.
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setConfirmCompleteOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={doComplete}>
              {busy ? "Completing…" : "Confirm complete"}
            </Button>
          </div>
        </Dialog>
      )}

      {overheadOpen && (
        <Dialog title="Add production overhead" onClose={() => setOverheadOpen(false)}>
          <form onSubmit={handleAddOverhead} className="space-y-4">
            <label className="block">
              <span>Category</span>
              <select name="category" className="w-full" defaultValue="LABOUR">
                <option value="LABOUR">Labour</option>
                <option value="GAS_POWER">Gas & Power</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="block">
              <span>
                Amount (₹) <b>*</b>
              </span>
              <input
                name="amount"
                required
                inputMode="decimal"
                placeholder="500.00"
                className="w-full"
              />
            </label>
            <label className="block">
              <span>Note</span>
              <input name="note" placeholder="Optional details" className="w-full" />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setOverheadOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                Save overhead
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

export function ProductionRun() {
  const { role, notify } = useAuth();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [pendingPlan, setPendingPlan] = useState<
    Array<{
      product_id: number;
      product: string;
      pending_demand: number;
      on_hand: number;
      shortage: number;
      has_bom: boolean;
      suggested_batches: number;
    }>
  >([]);
  const [products, setProducts] = useState<ItemOption[]>([]);
  const [boms, setBoms] = useState<BomOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createProdId, setCreateProdId] = useState<string>("");
  const [basisMode, setBasisMode] = useState<"batches" | "material">("batches");
  const [basisItemId, setBasisItemId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (statusFilter) qs.set("status", statusFilter);
      const [runsRes, itemsRes, bomsRes, planRes] = await Promise.all([
        api<{ total: number; items: RunSummary[] }>(`/production/runs?${qs.toString()}`),
        api<ItemOption[]>("/items?kind=FINISHED"),
        api<BomOption[]>("/boms"),
        api<typeof pendingPlan>("/production/plan-pending"),
      ]);
      setRuns(runsRes.data.items);
      setProducts(itemsRes.data);
      setBoms(bomsRes.data);
      setPendingPlan(planRes.data);
      if (itemsRes.data.length > 0 && !createProdId) {
        setCreateProdId(String(itemsRes.data[0].id));
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, createProdId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeBom = boms.find((b) => String(b.product_id) === createProdId);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      product_id: Number(createProdId),
      planned_date: String(fd.get("planned_date") || todayISO()),
      notes: String(fd.get("notes") || "").trim() || null,
    };
    if (basisMode === "batches") {
      body.batches = Number(fd.get("batches") || 1);
    } else {
      const line = activeBom?.lines.find((l) => String(l.item_id) === basisItemId);
      body.basis_item_id = Number(basisItemId);
      body.basis_qty = Number(fd.get("basis_qty"));
      body.basis_unit = line?.unit || "kg";
    }
    try {
      const res = await api<RunDetail>("/production/runs", {
        method: "POST",
        body,
      });
      setCreateOpen(false);
      notify(`Created ${res.data.run_no}`);
      setSelectedId(res.data.id);
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (selectedId !== null) {
    return (
      <RunDetailView
        runId={selectedId}
        onBack={() => {
          setSelectedId(null);
          load();
        }}
      />
    );
  }

  const canWrite = role === "ADMIN" || role === "PRODUCTION";

  return (
    <div>
      <PageHeader
        eyebrow="PRODUCTION"
        title="Production runs"
        description="Plan batches, issue raw materials, record output and track variances."
        action={
          <div className="header-actions">
            <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
              Refresh
            </Button>
            {canWrite && (
              <Button icon="plus" onClick={() => setCreateOpen(true)}>
                New run
              </Button>
            )}
          </div>
        }
      />

      <div className="tabs" role="tablist">
        {[
          { label: "All", value: "" },
          { label: "Planned", value: "PLANNED" },
          { label: "Issued", value: "ISSUED" },
          { label: "Completed", value: "COMPLETED" },
        ].map((t) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={statusFilter === t.value}
            onClick={() => setStatusFilter(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {pendingPlan.some((p) => p.shortage > 0) && (
        <div className="card p-4 mb-4">
          <div className="section-heading mb-2">
            <div>
              <h3>Pending order demand</h3>
              <p>Suggested production to fulfil open orders</p>
            </div>
            <Badge tone="warning">ACTION SUGGESTED</Badge>
          </div>
          <div className="space-y-2">
            {pendingPlan
              .filter((p) => p.shortage > 0)
              .map((p) => (
                <div
                  key={p.product_id}
                  className="flex flex-wrap items-center justify-between gap-3 text-sm border-b border-[var(--border)] pb-2"
                >
                  <div>
                    <strong>{p.product}</strong>
                    <div className="text-xs text-[var(--muted)]">
                      Pending demand {p.pending_demand} pkts · On hand {p.on_hand} pkts · Short{" "}
                      {p.shortage} pkts
                    </div>
                  </div>
                  {canWrite && p.has_bom && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCreateProdId(String(p.product_id));
                        setBasisMode("batches");
                        setCreateOpen(true);
                      }}
                    >
                      Make {p.suggested_batches} batch(es)
                    </Button>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
      {loading && <LoadingState label="Loading production runs…" />}

      {!loading && runs.length === 0 && (
        <EmptyState
          icon="factory"
          title="No production runs"
          description="Create a new production run to issue materials and record output."
        />
      )}

      {!loading && runs.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Run No</th>
                <th>Product</th>
                <th>Planned date</th>
                <th className="number">Batches</th>
                <th className="number">Planned</th>
                <th className="number">Good output</th>
                <th>Flags</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(r.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(r.id)}
                >
                  <td>
                    <strong>{r.run_no}</strong>
                  </td>
                  <td>{r.product}</td>
                  <td>{formatDate(r.planned_date)}</td>
                  <td className="number">{r.batches}</td>
                  <td className="number">{r.planned_output}</td>
                  <td className="number">{r.good_output ?? "—"}</td>
                  <td>{r.flag_count ? <Badge tone="warning">{r.flag_count} FLAG</Badge> : "—"}</td>
                  <td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td>
                    <Icon name="chevron" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {createOpen && (
        <Dialog title="Start new production run" onClose={() => setCreateOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <label className="block">
              <span>
                Finished product <b>*</b>
              </span>
              <select
                required
                className="w-full"
                value={createProdId}
                onChange={(e) => {
                  setCreateProdId(e.target.value);
                  setBasisItemId("");
                }}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="unit-toggle">
              <button
                type="button"
                className={basisMode === "batches" ? "active" : ""}
                onClick={() => setBasisMode("batches")}
              >
                Number of batches
              </button>
              <button
                type="button"
                className={basisMode === "material" ? "active" : ""}
                onClick={() => setBasisMode("material")}
              >
                Raw material basis
              </button>
            </div>

            {basisMode === "batches" ? (
              <label className="block">
                <span>Batches</span>
                <input
                  name="batches"
                  type="number"
                  step="0.5"
                  min="0.1"
                  defaultValue="1"
                  className="w-full"
                />
              </label>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span>
                    BOM Material <b>*</b>
                  </span>
                  <select
                    required
                    className="w-full"
                    value={basisItemId}
                    onChange={(e) => setBasisItemId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {activeBom?.lines.map((l) => (
                      <option key={l.item_id} value={l.item_id}>
                        {l.name} ({l.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>
                    Quantity <b>*</b>
                  </span>
                  <input
                    name="basis_qty"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="w-full"
                  />
                </label>
              </div>
            )}

            <label className="block">
              <span>Planned date</span>
              <input name="planned_date" type="date" defaultValue={todayISO()} className="w-full" />
            </label>
            <label className="block">
              <span>Notes</span>
              <input name="notes" placeholder="Optional shift or batch note" className="w-full" />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Creating…" : "Create run"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
