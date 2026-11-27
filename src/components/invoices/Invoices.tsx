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
import { ApiError, api, apiDownload } from "@/services/api";
import { formatDate, formatMoney } from "@/utils/format";
import { statusTone } from "@/utils/helpers";
import { useAuth } from "@/context/AuthContext";

type InvoiceSummary = {
  id: number;
  invoice_no: string;
  order_id: number;
  customer_id: number;
  buyer_name: string;
  buyer_gstin: string | null;
  invoice_date: string;
  supply_type: string;
  total_paise: number;
  status: string;
  dispatch_status: string;
  outstanding_paise: number | null;
};

type InvoiceDetail = InvoiceSummary & {
  place_of_supply: string;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  round_off_paise: number;
  cancel_reason: string | null;
  lines: Array<{
    id: number;
    item_id: number;
    description: string;
    hsn_code: string | null;
    qty: number;
    price_paise: number;
    taxable_paise: number;
    gst_rate_bp: number;
    cgst_paise: number;
    sgst_paise: number;
    igst_paise: number;
    dispatched_qty: number;
  }>;
  dispatches: Array<{
    id: number;
    dispatch_no: string;
    date: string;
    vehicle_no: string | null;
    lines: Array<{ item_id: number; qty: number; batch_no: string; expiry_date: string }>;
  }>;
  credit_note: {
    cn_no: string;
    date: string;
    reason: string;
    total_paise: number;
    stock_returned: boolean;
  } | null;
};

function InvoiceDetailView({ invoiceId, onBack }: { invoiceId: number; onBack: () => void }) {
  const { role, notify } = useAuth();
  const [inv, setInv] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchQtys, setDispatchQtys] = useState<Record<number, string>>({});
  const [dispatchShortage, setDispatchShortage] = useState<
    Array<{ item_id: number; name: string; on_hand: number; requested: number }>
  >([]);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQtys, setReturnQtys] = useState<Record<number, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<InvoiceDetail>(`/invoices/${invoiceId}`);
      setInv(res.data);
      const q: Record<number, string> = {};
      for (const l of res.data.lines) {
        const rem = Math.max(0, l.qty - l.dispatched_qty);
        if (rem > 0) q[l.id] = String(rem);
      }
      setDispatchQtys(q);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDispatch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inv) return;
    setBusy(true);
    setError(null);
    setDispatchShortage([]);
    const fd = new FormData(e.currentTarget);
    const lines = inv.lines
      .map((l) => ({
        invoice_line_id: l.id,
        qty: Math.floor(Number(dispatchQtys[l.id] || 0)),
      }))
      .filter((l) => l.qty > 0);
    try {
      const res = await api<{ dispatch_no: string }>(`/invoices/${inv.id}/dispatch`, {
        method: "POST",
        body: {
          lines: lines.length > 0 ? lines : null,
          vehicle_no: String(fd.get("vehicle_no") || "").trim() || null,
          notes: String(fd.get("notes") || "").trim() || null,
        },
      });
      setDispatchOpen(false);
      notify(`Dispatched (${res.data.dispatch_no})`);
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === "insufficient_stock" && err.details) {
        const det = err.details as {
          lines?: Array<{ item_id: number; name: string; on_hand: number; requested: number }>;
        };
        if (det.lines) setDispatchShortage(det.lines);
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function fillAvailableForDispatch() {
    if (!inv) return;
    const next = { ...dispatchQtys };
    for (const s of dispatchShortage) {
      const line = inv.lines.find((l) => l.item_id === s.item_id);
      if (line) {
        const rem = Math.max(0, line.qty - line.dispatched_qty);
        next[line.id] = String(Math.min(rem, Math.max(0, s.on_hand)));
      }
    }
    setDispatchQtys(next);
    setDispatchShortage([]);
  }

  async function handleCancel(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inv) return;
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      await api(`/invoices/${inv.id}/cancel`, {
        method: "POST",
        body: { reason: String(fd.get("reason") || "").trim() },
      });
      setCancelOpen(false);
      notify("Invoice cancelled and credit note issued");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare(kind: "whatsapp" | "email") {
    if (!inv) return;
    try {
      const res = await api<{ whatsapp_url: string; mailto_url: string }>(
        `/invoices/${inv.id}/share`,
      );
      window.open(
        kind === "whatsapp" ? res.data.whatsapp_url : res.data.mailto_url,
        "_blank",
        "noopener",
      );
    } catch (err) {
      setError(err);
    }
  }

  async function handleReturn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!inv) return;
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const lines = inv.lines
      .map((l) => ({
        invoice_line_id: l.id,
        qty: Math.floor(Number(returnQtys[l.id] || 0)),
      }))
      .filter((l) => l.qty > 0);
    try {
      const res = await api<{ credit_note_no: string }>(`/invoices/${inv.id}/return`, {
        method: "POST",
        body: { lines, reason: String(fd.get("reason") || "").trim() },
      });
      setReturnOpen(false);
      notify(`Partial return recorded (${res.data.credit_note_no})`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !inv) return <LoadingState label="Loading invoice…" />;
  if (!inv) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          ‹ All invoices
        </button>
        <ErrorBanner error={error} onRetry={load} />
      </div>
    );
  }

  const isAdmin = role === "ADMIN";
  const canDispatch = isAdmin && inv.status === "ISSUED" && inv.dispatch_status !== "FULL";
  const canReturn =
    isAdmin && inv.status === "ISSUED" && inv.dispatch_status !== "NONE" && !inv.credit_note;
  const canCancel = isAdmin && inv.status === "ISSUED";

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ‹ All invoices
      </button>
      <PageHeader
        eyebrow="INVOICE"
        title={inv.invoice_no}
        description={`${inv.buyer_name} · ${formatDate(inv.invoice_date)} · ${inv.supply_type}`}
        action={
          <div className="header-actions flex-wrap">
            <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
            <Badge tone={statusTone(inv.dispatch_status)}>{inv.dispatch_status} DISPATCH</Badge>
            <Button
              variant="secondary"
              icon="download"
              onClick={() =>
                apiDownload(`/invoices/${inv.id}/pdf`, `${inv.invoice_no.replace(/\//g, "-")}.pdf`)
              }
            >
              PDF
            </Button>
            <Button
              variant="secondary"
              icon="download"
              onClick={() =>
                apiDownload(
                  `/invoices/${inv.id}/einvoice`,
                  `${inv.invoice_no.replace(/\//g, "-")}-einvoice.json`,
                )
              }
            >
              e-Invoice JSON
            </Button>
            <Button variant="secondary" onClick={() => handleShare("whatsapp")}>
              WhatsApp
            </Button>
            <Button variant="secondary" onClick={() => handleShare("email")}>
              Email
            </Button>
          </div>
        }
      />
      <ErrorBanner error={error} onRetry={load} />

      <div className="stats">
        <Stat label="Taxable value" value={formatMoney(inv.taxable_paise)} />
        <Stat
          label="Total GST"
          value={formatMoney(inv.cgst_paise + inv.sgst_paise + inv.igst_paise)}
          note={inv.supply_type === "INTRA" ? "CGST + SGST" : "IGST"}
        />
        <Stat label="Invoice total" value={formatMoney(inv.total_paise)} />
        <Stat
          label="Outstanding"
          value={formatMoney(inv.outstanding_paise)}
          note={inv.status === "CANCELLED" ? "Cancelled" : undefined}
        />
      </div>

      <div className="table-card overflow-x-auto mb-6">
        <div className="table-title">
          <h2>Line items</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>HSN</th>
              <th className="number">Qty</th>
              <th className="number">Dispatched</th>
              <th className="number">Rate</th>
              <th className="number">Taxable</th>
              <th className="number">GST %</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  <strong>{l.description}</strong>
                </td>
                <td>{l.hsn_code || "—"}</td>
                <td className="number">{l.qty}</td>
                <td className="number">{l.dispatched_qty}</td>
                <td className="number">{formatMoney(l.price_paise)}</td>
                <td className="number">{formatMoney(l.taxable_paise)}</td>
                <td className="number">{l.gst_rate_bp / 100}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inv.dispatches.length > 0 && (
        <div className="card p-5 mb-6">
          <h2 className="mb-3">Dispatches</h2>
          <div className="space-y-3">
            {inv.dispatches.map((d) => (
              <div key={d.id} className="border-b border-[var(--border)] pb-2 text-sm">
                <strong>{d.dispatch_no}</strong> · {formatDate(d.date)}{" "}
                {d.vehicle_no ? `· Vehicle ${d.vehicle_no}` : ""}
                <div className="text-xs text-[var(--muted)] mt-1">
                  {d.lines.map((dl, idx) => (
                    <span key={idx} className="mr-3">
                      {dl.qty} pkts (Batch {dl.batch_no}, Exp {formatDate(dl.expiry_date)})
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {inv.credit_note && (
        <div className="card p-5 mb-6 border-[var(--danger)]">
          <p className="eyebrow">CREDIT NOTE</p>
          <strong>{inv.credit_note.cn_no}</strong> · {formatDate(inv.credit_note.date)} ·{" "}
          {formatMoney(inv.credit_note.total_paise)}
          <p className="text-sm text-[var(--muted)] mt-1">Reason: {inv.credit_note.reason}</p>
        </div>
      )}

      <div className="actions">
        {canDispatch && (
          <Button disabled={busy} onClick={() => setDispatchOpen(true)}>
            Record dispatch
          </Button>
        )}
        {canReturn && (
          <Button variant="secondary" disabled={busy} onClick={() => setReturnOpen(true)}>
            Partial return
          </Button>
        )}
        {canCancel && (
          <Button variant="danger" disabled={busy} onClick={() => setCancelOpen(true)}>
            Cancel invoice
          </Button>
        )}
      </div>

      {returnOpen && (
        <Dialog title="Partial sales return" onClose={() => setReturnOpen(false)}>
          <form onSubmit={handleReturn} className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Returns dispatched packets to stock and creates a Credit Note for the returned value.
            </p>
            <div className="space-y-2">
              {inv.lines
                .filter((l) => l.dispatched_qty > 0)
                .map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2"
                  >
                    <div className="text-sm">
                      <strong>{l.description}</strong>
                      <div className="text-xs text-[var(--muted)]">
                        Dispatched: {l.dispatched_qty} pkts
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={l.dispatched_qty}
                      placeholder="0"
                      className="w-24 text-right"
                      value={returnQtys[l.id] ?? ""}
                      onChange={(e) => setReturnQtys((p) => ({ ...p, [l.id]: e.target.value }))}
                    />
                  </div>
                ))}
            </div>
            <label className="block">
              <span>
                Return reason <b>*</b>
              </span>
              <input
                name="reason"
                required
                minLength={3}
                placeholder="Damaged in transit"
                className="w-full"
              />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setReturnOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Processing…" : "Confirm return"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {dispatchOpen && (
        <Dialog title="Dispatch goods (FEFO)" onClose={() => setDispatchOpen(false)}>
          <form onSubmit={handleDispatch} className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              Dispatch will reduce finished-goods stock using First-Expired-First-Out (FEFO) lots.
            </p>
            {dispatchShortage.length > 0 && (
              <div className="p-3 rounded bg-[var(--danger-soft)] text-sm">
                {dispatchShortage.map((s) => (
                  <div key={s.item_id}>
                    <strong>{s.name}</strong>: requested {s.requested}, on hand {s.on_hand}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2"
                  onClick={fillAvailableForDispatch}
                >
                  Dispatch what's available
                </Button>
              </div>
            )}
            <div className="space-y-2">
              {inv.lines
                .filter((l) => l.qty - l.dispatched_qty > 0)
                .map((l) => {
                  const rem = l.qty - l.dispatched_qty;
                  return (
                    <div
                      key={l.id}
                      className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2"
                    >
                      <div className="text-sm">
                        <strong>{l.description}</strong>
                        <div className="text-xs text-[var(--muted)]">Remaining: {rem} pkts</div>
                      </div>
                      <input
                        type="number"
                        min={0}
                        max={rem}
                        className="w-24 text-right"
                        value={dispatchQtys[l.id] ?? String(rem)}
                        onChange={(e) => setDispatchQtys((p) => ({ ...p, [l.id]: e.target.value }))}
                      />
                    </div>
                  );
                })}
            </div>
            <label className="block">
              <span>Vehicle number</span>
              <input name="vehicle_no" placeholder="TN-01-AB-1234" className="w-full" />
            </label>
            <label className="block">
              <span>Notes</span>
              <input name="notes" placeholder="Driver / LR details" className="w-full" />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setDispatchOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Dispatching…" : "Confirm dispatch"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {cancelOpen && (
        <Dialog title="Cancel invoice" onClose={() => setCancelOpen(false)}>
          <form onSubmit={handleCancel} className="space-y-4">
            <p className="text-sm text-[var(--muted)]">
              This creates a credit note, returns dispatched goods to stock and cannot be undone.
            </p>
            <label className="block">
              <span>
                Cancellation reason <b>*</b>
              </span>
              <textarea name="reason" required minLength={3} rows={3} className="w-full" />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setCancelOpen(false)}>
                Keep invoice
              </Button>
              <Button variant="danger" type="submit" disabled={busy}>
                {busy ? "Cancelling…" : "Confirm cancel"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}

export function Invoices() {
  const [items, setItems] = useState<InvoiceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (statusFilter) qs.set("status", statusFilter);
      const res = await api<{ total: number; items: InvoiceSummary[] }>(
        `/invoices?${qs.toString()}`,
      );
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  if (selectedId !== null) {
    return (
      <InvoiceDetailView
        invoiceId={selectedId}
        onBack={() => {
          setSelectedId(null);
          load();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="BILLING"
        title="Invoices"
        description={`${total} GST tax invoices`}
        action={
          <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="tabs" role="tablist">
        {[
          { label: "All", value: "" },
          { label: "Issued", value: "ISSUED" },
          { label: "Cancelled", value: "CANCELLED" },
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
      {loading && <LoadingState label="Loading invoices…" />}
      {!loading && items.length === 0 && (
        <EmptyState
          icon="file"
          title="No invoices"
          description="Approve an order to raise a GST invoice."
        />
      )}
      {!loading && items.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Date</th>
                <th>Customer</th>
                <th className="number">Total</th>
                <th className="number">Outstanding</th>
                <th>Status</th>
                <th>Dispatch</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => setSelectedId(i.id)}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedId(i.id)}
                >
                  <td>
                    <strong>{i.invoice_no}</strong>
                  </td>
                  <td>{formatDate(i.invoice_date)}</td>
                  <td>{i.buyer_name}</td>
                  <td className="number">{formatMoney(i.total_paise)}</td>
                  <td className="number">{formatMoney(i.outstanding_paise)}</td>
                  <td>
                    <Badge tone={statusTone(i.status)}>{i.status}</Badge>
                  </td>
                  <td>
                    <Badge tone={statusTone(i.dispatch_status)}>{i.dispatch_status}</Badge>
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
    </div>
  );
}
