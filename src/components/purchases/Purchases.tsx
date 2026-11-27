import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Dialog, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { formatDate, formatMoney, rupeesToPaise, todayISO } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";

type Purchase = {
  id: number;
  purchase_no: string;
  supplier_id: number;
  supplier: string;
  supplier_invoice_no: string | null;
  purchase_date: string;
  taxable_paise: number;
  tax_paise: number;
  total_paise: number;
  lines: Array<{
    item_id: number;
    item: string;
    qty: string;
    unit: string;
    value_paise: number;
  }>;
};

type SupplierOpt = { id: number; name: string };
type ItemOpt = {
  id: number;
  name: string;
  kind: string;
  display_unit: string;
  gst_rate_bp: number;
};

type LineDraft = { item_id: string; qty: string; unit: string; rate: string; gst_pct: string };

export function Purchases() {
  const { role, notify } = useAuth();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOpt[]>([]);
  const [items, setItems] = useState<ItemOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([
    { item_id: "", qty: "", unit: "kg", rate: "", gst_pct: "5" },
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [purRes, supRes, itemRes] = await Promise.all([
        api<{ total: number; items: Purchase[] }>("/purchases?limit=50"),
        api<SupplierOpt[]>("/suppliers"),
        api<ItemOpt[]>("/items"),
      ]);
      setPurchases(purRes.data.items);
      setSuppliers(supRes.data);
      setItems(itemRes.data.filter((i) => i.kind !== "FINISHED"));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const payloadLines = lines
        .filter((l) => l.item_id && Number(l.qty) > 0)
        .map((l) => ({
          item_id: Number(l.item_id),
          qty: Number(l.qty),
          unit: l.unit,
          rate_paise: rupeesToPaise(l.rate || "0"),
          gst_rate_bp: Math.round(Number(l.gst_pct || 0) * 100),
        }));
      const res = await api<Purchase>("/purchases", {
        method: "POST",
        body: {
          supplier_id: Number(fd.get("supplier_id")),
          supplier_invoice_no: String(fd.get("supplier_invoice_no") || "").trim() || null,
          purchase_date: String(fd.get("purchase_date") || todayISO()),
          lines: payloadLines,
        },
      });
      setOpen(false);
      setLines([{ item_id: "", qty: "", unit: "kg", rate: "", gst_pct: "5" }]);
      notify(`Recorded purchase ${res.data.purchase_no}`);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const canWrite = role === "ADMIN" || role === "PRODUCTION";

  return (
    <div>
      <PageHeader
        eyebrow="PROCUREMENT"
        title="Purchases"
        description="Record raw material and packaging receipts into stock."
        action={
          <div className="header-actions">
            <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
              Refresh
            </Button>
            {canWrite && (
              <Button icon="plus" onClick={() => setOpen(true)}>
                Record purchase
              </Button>
            )}
          </div>
        }
      />

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading purchases…" />}
      {!loading && purchases.length === 0 && (
        <EmptyState
          icon="bag"
          title="No purchases"
          description="Record a supplier purchase to add stock."
        />
      )}
      {!loading && purchases.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Purchase No</th>
                <th>Date</th>
                <th>Supplier</th>
                <th>Vendor Invoice</th>
                <th>Items</th>
                <th className="number">Taxable</th>
                <th className="number">GST</th>
                <th className="number">Total</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.purchase_no}</strong>
                  </td>
                  <td>{formatDate(p.purchase_date)}</td>
                  <td>{p.supplier}</td>
                  <td>{p.supplier_invoice_no || "—"}</td>
                  <td>{p.lines.map((l) => `${l.item} (${l.qty} ${l.unit})`).join(", ")}</td>
                  <td className="number">{formatMoney(p.taxable_paise)}</td>
                  <td className="number">{formatMoney(p.tax_paise)}</td>
                  <td className="number">
                    <strong>{formatMoney(p.total_paise)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Dialog title="Record purchase" onClose={() => setOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <label className="block">
              <span>
                Supplier <b>*</b>
              </span>
              <select name="supplier_id" required className="w-full">
                <option value="">Select supplier…</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>Supplier invoice no</span>
                <input name="supplier_invoice_no" className="w-full" />
              </label>
              <label>
                <span>Purchase date</span>
                <input
                  name="purchase_date"
                  type="date"
                  defaultValue={todayISO()}
                  className="w-full"
                />
              </label>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Items</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setLines((p) => [
                      ...p,
                      { item_id: "", qty: "", unit: "kg", rate: "", gst_pct: "5" },
                    ])
                  }
                >
                  + Add line
                </Button>
              </div>
              {lines.map((ln, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    className="col-span-5"
                    required
                    value={ln.item_id}
                    onChange={(e) => {
                      const it = items.find((i) => String(i.id) === e.target.value);
                      setLines((prev) =>
                        prev.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                item_id: e.target.value,
                                unit: it?.display_unit || r.unit,
                                gst_pct: it ? String(it.gst_rate_bp / 100) : r.gst_pct,
                              }
                            : r,
                        ),
                      );
                    }}
                  >
                    <option value="">Item…</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.name} ({it.display_unit})
                      </option>
                    ))}
                  </select>
                  <input
                    className="col-span-2"
                    placeholder="Qty"
                    required
                    inputMode="decimal"
                    value={ln.qty}
                    onChange={(e) =>
                      setLines((p) =>
                        p.map((r, i) => (i === idx ? { ...r, qty: e.target.value } : r)),
                      )
                    }
                  />
                  <input
                    className="col-span-3"
                    placeholder="Rate ₹"
                    required
                    inputMode="decimal"
                    value={ln.rate}
                    onChange={(e) =>
                      setLines((p) =>
                        p.map((r, i) => (i === idx ? { ...r, rate: e.target.value } : r)),
                      )
                    }
                  />
                  <input
                    className="col-span-2"
                    placeholder="GST%"
                    inputMode="decimal"
                    value={ln.gst_pct}
                    onChange={(e) =>
                      setLines((p) =>
                        p.map((r, i) => (i === idx ? { ...r, gst_pct: e.target.value } : r)),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save purchase"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
