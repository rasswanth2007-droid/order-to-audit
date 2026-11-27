import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { formatMoney, paiseToRupeesInput, rupeesToPaise } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/utils/i18n";

type Customer = {
  id: number;
  name: string;
  type: "RETAILER" | "DISTRIBUTOR";
  state_code: string;
  gstin: string | null;
  phone: string | null;
  address: string | null;
  credit_days: number;
  salesman_id: number | null;
  is_active: boolean;
};

type ItemOption = { id: number; name: string; selling_price_paise: number | null };
type CustPrice = { item_id: number; price_paise: number };

export function Customers() {
  const { role, notify } = useAuth();
  const tr = useT();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const [priceCust, setPriceCust] = useState<Customer | null>(null);
  const [finishedItems, setFinishedItems] = useState<ItemOption[]>([]);
  const [custPrices, setCustPrices] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<Customer[]>("/customers");
      setCustomers(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openPrices(c: Customer) {
    setPriceCust(c);
    try {
      const [itemsRes, pricesRes] = await Promise.all([
        api<ItemOption[]>("/items?kind=FINISHED"),
        api<CustPrice[]>(`/customers/${c.id}/prices`),
      ]);
      setFinishedItems(itemsRes.data);
      const map: Record<number, string> = {};
      for (const p of pricesRes.data) {
        map[p.item_id] = paiseToRupeesInput(p.price_paise);
      }
      setCustPrices(map);
    } catch (err) {
      setError(err);
    }
  }

  async function saveCustomer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get("name") || "").trim(),
      type: String(fd.get("type")),
      state_code: String(fd.get("state_code") || "33").trim(),
      gstin:
        String(fd.get("gstin") || "")
          .trim()
          .toUpperCase() || null,
      phone: String(fd.get("phone") || "").trim() || null,
      address: String(fd.get("address") || "").trim() || null,
      credit_days: Number(fd.get("credit_days") || 15),
      is_active: true,
    };
    try {
      if (editing === "new") {
        await api("/customers", { method: "POST", body });
        notify("Customer created");
      } else if (editing) {
        await api(`/customers/${editing.id}`, { method: "PUT", body });
        notify("Customer updated");
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function saveSpecialPrice(itemId: number) {
    if (!priceCust) return;
    const val = custPrices[itemId];
    if (!val) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/customers/${priceCust.id}/prices`, {
        method: "PUT",
        body: { item_id: itemId, price_paise: rupeesToPaise(val) },
      });
      notify("Special price saved");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="MASTERS"
        title="Customers"
        description="Retailers, distributors, GSTIN details and special price lists."
        action={
          role === "ADMIN" && (
            <Button icon="plus" onClick={() => setEditing("new")}>
              Add customer
            </Button>
          )
        }
      />

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading customers…" />}
      {!loading && customers.length === 0 && (
        <EmptyState
          icon="users"
          title="No customers"
          description="Add your first retailer or distributor."
        />
      )}
      {!loading && customers.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{tr("Name")}</th>
                <th>{tr("Type")}</th>
                <th>{tr("State")}</th>
                <th>{tr("GSTIN")}</th>
                <th>{tr("Phone")}</th>
                <th className="number">{tr("Credit days")}</th>
                <th>{tr("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>
                    <Badge tone={c.type === "DISTRIBUTOR" ? "primary" : "neutral"}>{c.type}</Badge>
                  </td>
                  <td>{c.state_code}</td>
                  <td>{c.gstin || "Unregistered"}</td>
                  <td>{c.phone || "—"}</td>
                  <td className="number">{c.credit_days}</td>
                  <td>
                    {role === "ADMIN" && (
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => openPrices(c)}>
                          Prices
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Dialog
          title={editing === "new" ? "New customer" : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={saveCustomer} className="space-y-4">
            <label className="block">
              <span>
                Business name <b>*</b>
              </span>
              <input
                name="name"
                required
                defaultValue={editing === "new" ? "" : editing.name}
                className="w-full"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>Type</span>
                <select
                  name="type"
                  defaultValue={editing === "new" ? "RETAILER" : editing.type}
                  className="w-full"
                >
                  <option value="RETAILER">Retailer</option>
                  <option value="DISTRIBUTOR">Distributor</option>
                </select>
              </label>
              <label>
                <span>
                  State code <b>*</b>
                </span>
                <input
                  name="state_code"
                  required
                  pattern="^[0-9]{2}$"
                  defaultValue={editing === "new" ? "33" : editing.state_code}
                  className="w-full"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>GSTIN</span>
                <input
                  name="gstin"
                  placeholder="33AAAAA0000A1Z5"
                  defaultValue={editing === "new" ? "" : editing.gstin || ""}
                  className="w-full"
                />
              </label>
              <label>
                <span>Phone</span>
                <input
                  name="phone"
                  defaultValue={editing === "new" ? "" : editing.phone || ""}
                  className="w-full"
                />
              </label>
            </div>
            <label className="block">
              <span>Credit days</span>
              <input
                name="credit_days"
                type="number"
                min={0}
                max={365}
                defaultValue={editing === "new" ? 15 : editing.credit_days}
                className="w-full"
              />
            </label>
            <label className="block">
              <span>Address</span>
              <textarea
                name="address"
                rows={2}
                defaultValue={editing === "new" ? "" : editing.address || ""}
                className="w-full"
              />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}

      {priceCust && (
        <Dialog title={`Special prices: ${priceCust.name}`} onClose={() => setPriceCust(null)}>
          <div className="space-y-3">
            {finishedItems.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2"
              >
                <div>
                  <strong className="text-sm">{it.name}</strong>
                  <div className="text-xs text-[var(--muted)]">
                    Standard: {formatMoney(it.selling_price_paise)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className="w-24 text-right"
                    inputMode="decimal"
                    placeholder="₹"
                    value={custPrices[it.id] ?? ""}
                    onChange={(e) => setCustPrices((p) => ({ ...p, [it.id]: e.target.value }))}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => saveSpecialPrice(it.id)}
                  >
                    Save
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
