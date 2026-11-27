import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, EmptyState, ErrorBanner, Icon, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { formatDate, formatMoney } from "@/utils/format";
import { statusTone } from "@/utils/helpers";
import {
  listQueuedOrders,
  removeQueuedOrder,
  syncQueuedOrders,
  type QueuedOrder,
} from "@/utils/offlineQueue";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/utils/i18n";

export type OrderSummary = {
  id: number;
  order_no: string;
  status: string;
  customer_id: number;
  customer: string;
  salesman: string;
  created_at: string;
  total_paise: number;
  invoice?: { id: number; invoice_no: string; status: string; dispatch_status: string } | null;
};

type OrdersListRes = { total: number; items: OrderSummary[] };

const TABS = [
  { label: "Submitted", status: "SUBMITTED" },
  { label: "Approved", status: "APPROVED" },
  { label: "Invoiced", status: "INVOICED" },
  { label: "Dispatched", status: "DISPATCHED" },
  { label: "Rejected", status: "REJECTED" },
  { label: "All", status: "" },
] as const;

const PAGE_SIZE = 20;

export function OrdersInbox({
  onOpen,
  mobile = false,
}: {
  onOpen: (orderId: number) => void;
  mobile?: boolean;
}) {
  const { notify } = useAuth();
  const tr = useT();
  const [tab, setTab] = useState<string>(mobile ? "" : "SUBMITTED");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [res, setRes] = useState<OrdersListRes>({ total: 0, items: [] });
  const [queued, setQueued] = useState<QueuedOrder[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (tab) qs.set("status", tab);
      const [out, q] = await Promise.all([
        api<OrdersListRes>(`/orders?${qs.toString()}`),
        mobile ? listQueuedOrders() : Promise.resolve([]),
      ]);
      setRes(out.data);
      setQueued(q);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tab, offset, mobile]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSendNow() {
    setSyncing(true);
    try {
      const r = await syncQueuedOrders();
      notify(`Sent ${r.sent} order(s)${r.failed ? `, ${r.failed} failed` : ""}`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return res.items;
    return res.items.filter(
      (o) =>
        o.order_no.toLowerCase().includes(q) ||
        o.customer.toLowerCase().includes(q) ||
        o.salesman.toLowerCase().includes(q),
    );
  }, [res.items, query]);

  const start = res.total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + res.items.length, res.total);

  return (
    <div>
      <PageHeader
        eyebrow={mobile ? undefined : "SALES"}
        title={mobile ? "My orders" : "Orders inbox"}
        description={
          mobile
            ? "Track orders from submission to delivery."
            : "Review new orders and move approved sales forward."
        }
        action={
          <Button icon="refresh" variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {mobile && queued.length > 0 && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center justify-between">
            <Badge tone="warning">WAITING TO SEND ({queued.length})</Badge>
            <Button variant="secondary" disabled={syncing} onClick={handleSendNow}>
              {syncing ? "Sending…" : "Send now"}
            </Button>
          </div>
          {queued.map((q) => (
            <div key={q.client_ref} className="card p-4 flex items-center justify-between gap-3">
              <div>
                <strong>{q.customer_name}</strong>
                <div className="text-xs text-[var(--muted)]">
                  {q.lines.length} item(s) · Est. {formatMoney(q.estimated_total_paise)}
                </div>
                {q.last_error && <div className="text-xs text-[var(--danger)]">{q.last_error}</div>}
              </div>
              <Button
                variant="ghost"
                onClick={async () => {
                  await removeQueuedOrder(q.client_ref);
                  await load();
                }}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Order status">
        {TABS.map((t) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => {
              setTab(t.status);
              setOffset(0);
            }}
          >
            {tr(t.label)}
          </button>
        ))}
      </div>
      <div className="filterbar">
        <label className="search">
          <Icon name="search" />
          <span className="sr-only">Search orders</span>
          <input
            placeholder="Search order, customer or salesman"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading orders…" />}

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon="bag"
          title="No orders found"
          description={
            tab
              ? `No orders with status ${tab}. Try switching tabs or clearing your search.`
              : "No orders recorded yet."
          }
        />
      )}

      {!loading && filtered.length > 0 && (
        <>
          <div className="table-card overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th scope="col">{tr("Order")}</th>
                  <th scope="col">{tr("Customer")}</th>
                  <th scope="col">{tr("Salesman")}</th>
                  <th scope="col">{tr("Date")}</th>
                  <th scope="col" className="number">
                    {tr("Total")}
                  </th>
                  <th scope="col">{tr("Status")}</th>
                  <th scope="col">{tr("Invoice")}</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr
                    key={o.id}
                    tabIndex={0}
                    className="cursor-pointer"
                    onClick={() => onOpen(o.id)}
                    onKeyDown={(e) => e.key === "Enter" && onOpen(o.id)}
                  >
                    <td>
                      <strong>{o.order_no}</strong>
                    </td>
                    <td>{o.customer}</td>
                    <td>{o.salesman}</td>
                    <td>{formatDate(o.created_at)}</td>
                    <td className="number">
                      <strong>{formatMoney(o.total_paise)}</strong>
                    </td>
                    <td>
                      <Badge tone={statusTone(o.status)}>{o.status}</Badge>
                    </td>
                    <td>{o.invoice ? o.invoice.invoice_no : "—"}</td>
                    <td>
                      <Icon name="chevron" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <p>
              Showing {start}–{end} of {res.total}
            </p>
            <div>
              <Button
                variant="secondary"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={offset + PAGE_SIZE >= res.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
