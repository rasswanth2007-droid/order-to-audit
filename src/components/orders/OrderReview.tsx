import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Dialog, ErrorBanner, Icon, LoadingState, PageHeader } from "../ui";
import { api, apiDownload } from "@/services/api";
import {
  formatDateTime,
  formatMoney,
  initials,
  paiseToRupeesInput,
  rupeesToPaise,
} from "@/utils/format";
import { statusTone } from "@/utils/helpers";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/utils/i18n";

type OrderLine = {
  id: number;
  item_id: number;
  name: string;
  qty: number;
  price_paise: number;
  orig_qty: number;
  orig_price_paise: number;
  amount_paise: number;
};

type OrderDetail = {
  id: number;
  order_no: string;
  status: string;
  customer_id: number;
  customer: string;
  customer_state: string;
  salesman: string;
  notes: string | null;
  rejection_reason: string | null;
  created_at: string;
  total_paise: number;
  lines: OrderLine[];
  invoice: {
    id: number;
    invoice_no: string;
    status: string;
    dispatch_status: string;
    total_paise: number;
  } | null;
};

type StockCheckRes = {
  order_id: number;
  sufficient: boolean;
  lines: Array<{
    item_id: number;
    name: string;
    required: number;
    on_hand: number;
    committed_to_others: number;
    available: number;
    shortage: number;
    suggested_batches_to_produce: number | null;
  }>;
};

export function OrderReview({ orderId, onBack }: { orderId: number; onBack: () => void }) {
  const { role, notify } = useAuth();
  const tr = useT();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [stock, setStock] = useState<StockCheckRes | null>(null);
  const [edits, setEdits] = useState<Record<number, { qty: string; price: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [shortageDialog, setShortageDialog] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState<{
    acceptShortage: boolean;
    raiseInvoice: boolean;
  } | null>(null);
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<OrderDetail>(`/orders/${orderId}`);
      setOrder(res.data);
      const map: Record<number, { qty: string; price: string }> = {};
      for (const l of res.data.lines) {
        map[l.item_id] = { qty: String(l.qty), price: paiseToRupeesInput(l.price_paise) };
      }
      setEdits(map);
      if (role === "ADMIN" && res.data.status === "SUBMITTED") {
        const sc = await api<StockCheckRes>(`/orders/${orderId}/stock-check`);
        setStock(sc.data);
      } else {
        setStock(null);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [orderId, role]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveChanges() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const lines = order.lines.map((l) => {
        const e = edits[l.item_id];
        return {
          item_id: l.item_id,
          qty: Number(e?.qty || l.qty),
          unit: "packet",
          price_paise: rupeesToPaise(e?.price || paiseToRupeesInput(l.price_paise)),
        };
      });
      await api(`/orders/${order.id}`, { method: "PUT", body: { lines } });
      notify("Order lines updated");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function reduceToAvailable() {
    if (!stock) return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const s of stock.lines) {
        if (next[s.item_id]) {
          next[s.item_id] = {
            ...next[s.item_id],
            qty: String(Math.max(1, s.available)),
          };
        }
      }
      return next;
    });
    setShortageDialog(false);
    notify("Quantities adjusted to available stock — click Save changes");
  }

  async function doApprove(acceptShortage: boolean, raiseInvoice: boolean) {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${order.id}/approve`, {
        method: "POST",
        body: { accept_shortage: acceptShortage, raise_invoice: raiseInvoice },
      });
      setShortageDialog(false);
      setConfirmApprove(null);
      notify(raiseInvoice ? "Order approved and invoiced" : "Order approved");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function doReject() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${order.id}/reject`, {
        method: "POST",
        body: { reason: rejectReason.trim() },
      });
      setRejectDialog(false);
      setRejectReason("");
      notify("Order rejected");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function doRaiseInvoice() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${order.id}/invoice`, { method: "POST" });
      notify("Invoice raised");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/orders/${order.id}/cancel`, { method: "POST" });
      notify("Order cancelled");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !order) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          ‹ Back to orders
        </button>
        <LoadingState label="Loading order details…" />
      </div>
    );
  }

  if (!order) {
    return (
      <div>
        <button className="back-link" onClick={onBack}>
          ‹ Back to orders
        </button>
        <ErrorBanner error={error} onRetry={load} />
      </div>
    );
  }

  const canAdminEdit = role === "ADMIN" && order.status === "SUBMITTED";
  const canCancel = (role === "ADMIN" || role === "SALESMAN") && order.status === "SUBMITTED";

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        {tr("‹ Back to orders")}
      </button>
      <PageHeader
        eyebrow="ORDER REVIEW"
        title={order.order_no}
        description={`Submitted ${formatDateTime(order.created_at)} by ${order.salesman}`}
        action={<Badge tone={statusTone(order.status)}>{order.status}</Badge>}
      />
      <ErrorBanner error={error} onRetry={load} />

      <div className="review-grid">
        <section>
          <div className="customer-strip">
            <div className="avatar">{initials(order.customer)}</div>
            <div>
              <span>Customer</span>
              <strong>{order.customer}</strong>
              <small>State code: {order.customer_state}</small>
            </div>
          </div>

          <div className="card order-lines">
            <div className="section-heading">
              <div>
                <h2>{tr("Order lines")}</h2>
                <p>Prices shown per packet</p>
              </div>
              <Badge>{order.lines.length} ITEMS</Badge>
            </div>
            <div className="line-head">
              <span>{tr("Product")}</span>
              <span>{tr("Quantity")}</span>
              <span>{tr("Price")}</span>
              <span>{tr("Amount")}</span>
            </div>
            {order.lines.map((l) => {
              const edit = edits[l.item_id];
              return (
                <div className="line-row" key={l.id}>
                  <div>
                    <strong>{l.name}</strong>
                    {l.price_paise !== l.orig_price_paise && (
                      <span className="text-xs text-[var(--muted)] line-through mr-2">
                        {formatMoney(l.orig_price_paise)}
                      </span>
                    )}
                    {l.qty !== l.orig_qty && (
                      <span className="text-xs text-[var(--muted)]">
                        Originally {l.orig_qty} pkts
                      </span>
                    )}
                  </div>
                  <label>
                    <span className="sr-only">Quantity</span>
                    <input
                      value={edit?.qty ?? String(l.qty)}
                      disabled={!canAdminEdit || busy}
                      inputMode="numeric"
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [l.item_id]: { ...prev[l.item_id], qty: e.target.value },
                        }))
                      }
                    />
                    <small>packet</small>
                  </label>
                  <label>
                    <span className="sr-only">Price</span>
                    <input
                      value={edit?.price ?? paiseToRupeesInput(l.price_paise)}
                      disabled={!canAdminEdit || busy}
                      inputMode="decimal"
                      onChange={(e) =>
                        setEdits((prev) => ({
                          ...prev,
                          [l.item_id]: { ...prev[l.item_id], price: e.target.value },
                        }))
                      }
                    />
                    <small>₹ / packet</small>
                  </label>
                  <strong>{formatMoney(l.amount_paise)}</strong>
                </div>
              );
            })}
            <div className="order-total">
              <span>Server total</span>
              <strong>{formatMoney(order.total_paise)}</strong>
            </div>
          </div>

          {order.notes && (
            <div className="card note-card">
              <span>Salesman's note</span>
              <p>{order.notes}</p>
            </div>
          )}

          {order.rejection_reason && (
            <div className="card note-card">
              <span>Rejection reason</span>
              <p className="danger-text">{order.rejection_reason}</p>
            </div>
          )}

          {order.invoice && (
            <div className="card p-5 mt-4 flex items-center justify-between gap-4">
              <div>
                <p className="eyebrow">INVOICE</p>
                <strong>{order.invoice.invoice_no}</strong>
                <p className="text-xs text-[var(--muted)]">
                  Status: {order.invoice.status} · Dispatch: {order.invoice.dispatch_status} · Total{" "}
                  {formatMoney(order.invoice.total_paise)}
                </p>
              </div>
              <Button
                variant="secondary"
                icon="download"
                onClick={() =>
                  apiDownload(
                    `/invoices/${order.invoice!.id}/pdf`,
                    `${order.invoice!.invoice_no.replace(/\//g, "-")}.pdf`,
                  )
                }
              >
                Invoice PDF
              </Button>
            </div>
          )}

          <div className="actions flex-wrap">
            {canAdminEdit && (
              <>
                <Button variant="secondary" disabled={busy} onClick={saveChanges}>
                  Save changes
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => setRejectDialog(true)}>
                  Reject
                </Button>
                <span className="action-spacer" />
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (stock && !stock.sufficient) setShortageDialog(true);
                    else setConfirmApprove({ acceptShortage: false, raiseInvoice: false });
                  }}
                >
                  Approve
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (stock && !stock.sufficient) setShortageDialog(true);
                    else setConfirmApprove({ acceptShortage: false, raiseInvoice: true });
                  }}
                >
                  Approve & create invoice
                </Button>
              </>
            )}
            {role === "ADMIN" && order.status === "APPROVED" && !order.invoice && (
              <Button disabled={busy} onClick={doRaiseInvoice}>
                Create GST invoice
              </Button>
            )}
            {canCancel && (
              <Button variant="ghost" disabled={busy} onClick={doCancel}>
                Cancel order
              </Button>
            )}
          </div>
        </section>

        {stock && (
          <aside className="card p-5 h-fit">
            <div className="section-heading">
              <div>
                <h2>Finished stock check</h2>
                <p>Free-to-promise packets</p>
              </div>
              <Badge tone={stock.sufficient ? "success" : "warning"}>
                {stock.sufficient ? "COVERED" : "SHORTAGE"}
              </Badge>
            </div>
            <div className="mt-4 space-y-3">
              {stock.lines.map((s) => (
                <div
                  key={s.item_id}
                  className="border-b border-[var(--border)] pb-3 text-sm space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <strong>{s.name}</strong>
                    <Badge tone={s.shortage === 0 ? "success" : "danger"}>
                      {s.shortage === 0 ? "OK" : `SHORT ${s.shortage}`}
                    </Badge>
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    Need {s.required} · On hand {s.on_hand} · Committed {s.committed_to_others} ·
                    Free {s.available}
                  </div>
                  {s.suggested_batches_to_produce && (
                    <div className="text-xs font-medium text-[var(--warning)]">
                      Produce {s.suggested_batches_to_produce} batch(es)
                    </div>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

      {confirmApprove && (
        <Dialog title="Confirm approval" onClose={() => setConfirmApprove(null)}>
          <p className="text-sm text-[var(--muted)] mb-4">
            {confirmApprove.raiseInvoice
              ? "Approving will commit finished stock and immediately generate a GST tax invoice."
              : "Approving will commit finished stock to this order."}
          </p>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setConfirmApprove(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => doApprove(confirmApprove.acceptShortage, confirmApprove.raiseInvoice)}
            >
              {busy ? "Processing…" : "Confirm"}
            </Button>
          </div>
        </Dialog>
      )}

      {shortageDialog && stock && (
        <Dialog title="Stock does not cover this order" onClose={() => setShortageDialog(false)}>
          <div className="dialog-warning">
            <Icon name="warning" />
            <div>
              {stock.lines
                .filter((s) => s.shortage > 0)
                .map((s) => (
                  <p key={s.item_id} className="mb-1">
                    <strong>{s.name}</strong> — need {s.required}, free {s.available}, short{" "}
                    {s.shortage} packets.
                  </p>
                ))}
            </div>
          </div>
          <p className="text-xs text-[var(--muted)] mt-3">
            Approving as back-order raises an invoice for the full quantity; you can dispatch only
            what is in stock.
          </p>
          <div className="dialog-actions flex-wrap">
            <Button variant="secondary" onClick={reduceToAvailable}>
              Reduce quantity to available
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setShortageDialog(false);
                setRejectDialog(true);
              }}
            >
              Reject
            </Button>
            <Button disabled={busy} onClick={() => doApprove(true, true)}>
              {busy ? "Approving…" : "Approve as back-order"}
            </Button>
          </div>
        </Dialog>
      )}

      {rejectDialog && (
        <Dialog title="Reject order" onClose={() => setRejectDialog(false)}>
          <label className="block">
            <span>
              Reason for rejection <b>*</b>
            </span>
            <textarea
              rows={3}
              className="w-full"
              placeholder="Explain why this order is rejected (min 3 chars)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <Button variant="secondary" onClick={() => setRejectDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy || rejectReason.trim().length < 3}
              onClick={doReject}
            >
              Confirm rejection
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
