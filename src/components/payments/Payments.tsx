import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api, apiDownload } from "@/services/api";
import { formatDate, formatMoney, rupeesToPaise, todayISO } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/utils/i18n";

type PaymentRow = {
  id: number;
  receipt_no: string;
  customer_id: number;
  customer: string;
  payment_date: string;
  amount_paise: number;
  mode: string;
  reference: string | null;
};

type CustomerOpt = { id: number; name: string };
type AccountRes = {
  customer: string;
  invoiced_paise: number;
  paid_paise: number;
  outstanding_paise: number;
  open_invoices: Array<{
    id: number;
    invoice_no: string;
    date: string;
    total_paise: number;
    outstanding_paise: number;
  }>;
};

type AgeingReport = {
  period: string;
  sections: Array<{
    title: string;
    columns: Array<{ key: string; label: string; kind: string }>;
    rows: Record<string, unknown>[];
  }>;
};

export function Payments() {
  const { role, notify } = useAuth();
  const tr = useT();
  const [tab, setTab] = useState<"payments" | "outstanding">("payments");
  const [items, setItems] = useState<PaymentRow[]>([]);
  const [ageing, setAgeing] = useState<AgeingReport | null>(null);
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedCustId, setSelectedCustId] = useState<string>("");
  const [account, setAccount] = useState<AccountRes | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "payments") {
        const [payRes, custRes] = await Promise.all([
          api<{ total: number; items: PaymentRow[] }>("/payments?limit=50"),
          api<CustomerOpt[]>("/customers"),
        ]);
        setItems(payRes.data.items);
        setCustomers(custRes.data);
      } else {
        const res = await api<AgeingReport>("/reports/outstanding?format=json");
        setAgeing(res.data);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedCustId) {
      setAccount(null);
      return;
    }
    api<AccountRes>(`/customers/${selectedCustId}/account`)
      .then((res) => setAccount(res.data))
      .catch(() => setAccount(null));
  }, [selectedCustId]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const invId = String(fd.get("invoice_id") || "");
    try {
      const res = await api<PaymentRow>("/payments", {
        method: "POST",
        body: {
          customer_id: Number(fd.get("customer_id")),
          amount_paise: rupeesToPaise(String(fd.get("amount"))),
          mode: String(fd.get("mode")),
          reference: String(fd.get("reference") || "").trim() || null,
          invoice_id: invId ? Number(invId) : null,
          payment_date: String(fd.get("payment_date") || todayISO()),
        },
      });
      setOpen(false);
      notify(`Recorded receipt ${res.data.receipt_no}`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="RECEIVABLES"
        title="Payments & receivables"
        description="Record customer collections and track outstanding ageing buckets."
        action={
          <div className="header-actions">
            <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
              Refresh
            </Button>
            {tab === "outstanding" && (
              <>
                <Button
                  variant="secondary"
                  icon="download"
                  onClick={() => apiDownload("/reports/outstanding?format=csv", "outstanding.csv")}
                >
                  CSV
                </Button>
                <Button
                  variant="secondary"
                  icon="download"
                  onClick={() => apiDownload("/reports/outstanding?format=pdf", "outstanding.pdf")}
                >
                  PDF
                </Button>
              </>
            )}
            {role === "ADMIN" && (
              <Button icon="plus" onClick={() => setOpen(true)}>
                Record payment
              </Button>
            )}
          </div>
        }
      />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "payments"} onClick={() => setTab("payments")}>
          {tr("Payments")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "outstanding"}
          onClick={() => setTab("outstanding")}
        >
          {tr("Outstanding & ageing")}
        </button>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading receivables…" />}

      {!loading && tab === "payments" && items.length === 0 && (
        <EmptyState
          icon="trend"
          title="No payments recorded"
          description="Record a customer receipt when money arrives."
        />
      )}
      {!loading && tab === "payments" && items.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{tr("Receipt No")}</th>
                <th>{tr("Date")}</th>
                <th>{tr("Customer")}</th>
                <th>{tr("Mode")}</th>
                <th>{tr("Reference")}</th>
                <th className="number">{tr("Amount")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.receipt_no}</strong>
                  </td>
                  <td>{formatDate(p.payment_date)}</td>
                  <td>{p.customer}</td>
                  <td>
                    <Badge tone="info">{p.mode}</Badge>
                  </td>
                  <td>{p.reference || "—"}</td>
                  <td className="number">
                    <strong>{formatMoney(p.amount_paise)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && tab === "outstanding" && ageing && (
        <div className="space-y-6">
          {ageing.sections.map((sec) => (
            <div className="table-card overflow-x-auto" key={sec.title}>
              <div className="table-title">
                <h2>{sec.title}</h2>
                <Badge>{sec.rows.length} ROWS</Badge>
              </div>
              {sec.rows.length === 0 ? (
                <p className="p-6 text-sm text-[var(--muted)]">No open balances.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      {sec.columns.map((c) => (
                        <th
                          key={c.key}
                          className={c.kind === "money" || c.kind === "int" ? "number" : ""}
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((r, i) => (
                      <tr key={i}>
                        {sec.columns.map((c) => (
                          <td
                            key={c.key}
                            className={c.kind === "money" || c.kind === "int" ? "number" : ""}
                          >
                            {c.kind === "money"
                              ? formatMoney(r[c.key] as number)
                              : c.kind === "date"
                                ? formatDate(String(r[c.key] || ""))
                                : String(r[c.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <Dialog title="Record customer payment" onClose={() => setOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <label className="block">
              <span>
                Customer <b>*</b>
              </span>
              <select
                name="customer_id"
                required
                className="w-full"
                value={selectedCustId}
                onChange={(e) => setSelectedCustId(e.target.value)}
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            {account && (
              <div className="p-3 rounded bg-[#f4f1ed] text-sm">
                <strong>Outstanding: {formatMoney(account.outstanding_paise)}</strong>
                <div className="text-xs text-[var(--muted)]">
                  Invoiced {formatMoney(account.invoiced_paise)} · Paid{" "}
                  {formatMoney(account.paid_paise)}
                </div>
              </div>
            )}

            {account && account.open_invoices.length > 0 && (
              <label className="block">
                <span>Allocate to invoice (optional)</span>
                <select name="invoice_id" className="w-full">
                  <option value="">Auto-allocate FIFO</option>
                  {account.open_invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.invoice_no} — Due {formatMoney(i.outstanding_paise)}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>
                  Amount (₹) <b>*</b>
                </span>
                <input
                  name="amount"
                  required
                  inputMode="decimal"
                  placeholder="5000.00"
                  className="w-full"
                />
              </label>
              <label>
                <span>Mode</span>
                <select name="mode" className="w-full" defaultValue="UPI">
                  <option value="UPI">UPI</option>
                  <option value="BANK">Bank Transfer</option>
                  <option value="CASH">Cash</option>
                  <option value="CHEQUE">Cheque</option>
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>Payment date</span>
                <input
                  name="payment_date"
                  type="date"
                  defaultValue={todayISO()}
                  className="w-full"
                />
              </label>
              <label>
                <span>UTR / Cheque Ref</span>
                <input name="reference" placeholder="Optional reference" className="w-full" />
              </label>
            </div>

            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save receipt"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
