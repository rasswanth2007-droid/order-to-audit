import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { formatDate, formatMoney, rupeesToPaise } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";

type StockRow = {
  item_id: number;
  sku: string;
  name: string;
  kind: string;
  qty: string;
  unit: string;
  value_paise: number;
  reorder_level: string;
  low_stock: boolean;
};

type LedgerRow = {
  id: number;
  item: string;
  date: string;
  movement_type: string;
  qty: string;
  unit: string;
  value_delta_paise: number;
  batch_no: string | null;
  narration: string | null;
};

type LotRow = {
  item_id: number;
  product: string;
  batch_no: string;
  expiry_date: string | null;
  qty: number;
};

type ReconcileRes = {
  ok: boolean;
  checks: Array<{ check: string; ledger: number; documents: number | null; ok: boolean }>;
};

export function Stock() {
  const { role, notify } = useAuth();
  const [tab, setTab] = useState<"summary" | "ledger" | "lots" | "reconcile">("summary");
  const [kindFilter, setKindFilter] = useState("");
  const [summary, setSummary] = useState<StockRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [lots, setLots] = useState<LotRow[]>([]);
  const [reconcile, setReconcile] = useState<ReconcileRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [adjOpen, setAdjOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "summary") {
        const qs = kindFilter ? `?kind=${kindFilter}` : "";
        const res = await api<StockRow[]>(`/inventory/summary${qs}`);
        setSummary(res.data);
      } else if (tab === "ledger") {
        const res = await api<{ total: number; items: LedgerRow[] }>("/inventory/ledger?limit=100");
        setLedger(res.data.items);
      } else if (tab === "lots") {
        const res = await api<LotRow[]>("/inventory/lots");
        setLots(res.data);
      } else if (tab === "reconcile") {
        const res = await api<ReconcileRes>("/inventory/reconcile");
        setReconcile(res.data);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tab, kindFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdjust(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const itemId = Number(fd.get("item_id"));
    const item = summary.find((s) => s.item_id === itemId);
    const qty = Number(fd.get("qty"));
    const valStr = String(fd.get("value") || "").trim();
    try {
      await api("/inventory/adjustments", {
        method: "POST",
        body: {
          item_id: itemId,
          qty,
          unit: item?.unit || "kg",
          reason: String(fd.get("reason") || "").trim(),
          batch_no: String(fd.get("batch_no") || "").trim() || null,
          value_paise: qty > 0 ? rupeesToPaise(valStr || "0") : null,
        },
      });
      setAdjOpen(false);
      notify("Stock adjustment posted");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const canAdjust = role === "ADMIN" || role === "PRODUCTION";
  const canReconcile = role === "ADMIN" || role === "ACCOUNTANT" || role === "OWNER";

  return (
    <div>
      <PageHeader
        eyebrow="INVENTORY"
        title="Stock & ledger"
        description="Real-time quantities, valuation, FEFO lots and ledger integrity."
        action={
          <div className="header-actions">
            <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
              Refresh
            </Button>
            {canAdjust && tab === "summary" && (
              <Button icon="plus" onClick={() => setAdjOpen(true)}>
                Adjust stock
              </Button>
            )}
          </div>
        }
      />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "summary"} onClick={() => setTab("summary")}>
          Stock summary
        </button>
        <button role="tab" aria-selected={tab === "ledger"} onClick={() => setTab("ledger")}>
          Movement ledger
        </button>
        <button role="tab" aria-selected={tab === "lots"} onClick={() => setTab("lots")}>
          Finished lots
        </button>
        {canReconcile && (
          <button
            role="tab"
            aria-selected={tab === "reconcile"}
            onClick={() => setTab("reconcile")}
          >
            Reconcile
          </button>
        )}
      </div>

      {tab === "summary" && (
        <div className="filterbar">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">All kinds</option>
            <option value="RAW">Raw materials</option>
            <option value="PACKAGING">Packaging</option>
            <option value="FINISHED">Finished goods</option>
          </select>
        </div>
      )}

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading inventory…" />}

      {!loading && tab === "summary" && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                <th>Kind</th>
                <th className="number">On hand</th>
                <th className="number">Reorder at</th>
                <th className="number">Value</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.item_id}>
                  <td>{s.sku}</td>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>{s.kind}</td>
                  <td className="number">
                    <strong>
                      {s.qty} {s.unit}
                    </strong>
                  </td>
                  <td className="number">
                    {s.reorder_level} {s.unit}
                  </td>
                  <td className="number">{formatMoney(s.value_paise)}</td>
                  <td>
                    <Badge tone={s.low_stock ? "danger" : "success"}>
                      {s.low_stock ? "LOW STOCK" : "OK"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === "ledger" && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Movement</th>
                <th className="number">Qty delta</th>
                <th className="number">Value delta</th>
                <th>Batch</th>
                <th>Narration</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.date)}</td>
                  <td>
                    <strong>{l.item}</strong>
                  </td>
                  <td>
                    <Badge tone="info">{l.movement_type}</Badge>
                  </td>
                  <td className="number">
                    {l.qty} {l.unit}
                  </td>
                  <td className="number">{formatMoney(l.value_delta_paise)}</td>
                  <td>{l.batch_no || "—"}</td>
                  <td>{l.narration || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === "lots" && (
        <>
          {lots.length === 0 ? (
            <EmptyState icon="box" title="No active finished lots" />
          ) : (
            <div className="table-card overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Batch No</th>
                    <th>Expiry</th>
                    <th className="number">Available packets</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map((l, idx) => (
                    <tr key={`${l.item_id}-${l.batch_no}-${idx}`}>
                      <td>
                        <strong>{l.product}</strong>
                      </td>
                      <td>{l.batch_no}</td>
                      <td>{formatDate(l.expiry_date)}</td>
                      <td className="number">
                        <strong>{l.qty}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && tab === "reconcile" && reconcile && (
        <div className="table-card overflow-x-auto">
          <div className="table-title">
            <h2>Ledger vs source documents</h2>
            <Badge tone={reconcile.ok ? "success" : "danger"}>
              {reconcile.ok ? "ALL CHECKS PASSED" : "MISMATCH FOUND"}
            </Badge>
          </div>
          <table>
            <thead>
              <tr>
                <th>Check</th>
                <th className="number">Ledger</th>
                <th className="number">Documents</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {reconcile.checks.map((c, idx) => (
                <tr key={idx}>
                  <td>{c.check}</td>
                  <td className="number">{c.ledger}</td>
                  <td className="number">{c.documents ?? "—"}</td>
                  <td>
                    <Badge tone={c.ok ? "success" : "danger"}>{c.ok ? "OK" : "FAIL"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adjOpen && (
        <Dialog title="Post stock adjustment" onClose={() => setAdjOpen(false)}>
          <form onSubmit={handleAdjust} className="space-y-4">
            <label className="block">
              <span>
                Item <b>*</b>
              </span>
              <select name="item_id" required className="w-full">
                {summary.map((s) => (
                  <option key={s.item_id} value={s.item_id}>
                    {s.name} ({s.qty} {s.unit})
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>
                  Qty (+ gain / − loss) <b>*</b>
                </span>
                <input name="qty" type="number" step="0.01" required className="w-full" />
              </label>
              <label>
                <span>Value (₹, for gains)</span>
                <input name="value" inputMode="decimal" placeholder="0.00" className="w-full" />
              </label>
            </div>
            <label className="block">
              <span>Batch No (optional)</span>
              <input name="batch_no" className="w-full" />
            </label>
            <label className="block">
              <span>
                Reason <b>*</b>
              </span>
              <input
                name="reason"
                required
                minLength={3}
                placeholder="Physical count variance"
                className="w-full"
              />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setAdjOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Posting…" : "Post adjustment"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
