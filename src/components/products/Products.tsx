import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { formatMoney, paiseToRupeesInput, rupeesToPaise } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";

type Item = {
  id: number;
  sku: string;
  name: string;
  kind: "FINISHED" | "RAW" | "PACKAGING";
  display_unit: string;
  hsn_code: string | null;
  gst_rate_bp: number;
  selling_price_paise: number | null;
  packets_per_carton: number | null;
  shelf_life_days: number | null;
  reorder_level: string;
  is_active: boolean;
};

export function Products() {
  const { role, notify } = useAuth();
  const [kind, setKind] = useState<"FINISHED" | "RAW" | "PACKAGING">(
    role === "PRODUCTION" ? "RAW" : "FINISHED",
  );
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<Item[]>(`/items?kind=${kind}&active_only=false`);
      setItems(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const priceRaw = String(fd.get("selling_price") || "").trim();
    const ppcRaw = String(fd.get("packets_per_carton") || "").trim();
    const shelfRaw = String(fd.get("shelf_life_days") || "").trim();

    try {
      if (editing === "new") {
        await api("/items", {
          method: "POST",
          body: {
            sku: String(fd.get("sku") || "").trim(),
            name: String(fd.get("name") || "").trim(),
            kind,
            display_unit: kind === "FINISHED" ? "packet" : String(fd.get("display_unit")),
            hsn_code: String(fd.get("hsn_code") || "").trim() || null,
            gst_rate_bp: Math.round(Number(fd.get("gst_pct") || 5) * 100),
            selling_price_paise: priceRaw ? rupeesToPaise(priceRaw) : null,
            packets_per_carton: ppcRaw ? Number(ppcRaw) : null,
            shelf_life_days: shelfRaw ? Number(shelfRaw) : null,
            reorder_level: String(fd.get("reorder_level") || "0"),
          },
        });
        notify("Item created");
      } else if (editing) {
        await api(`/items/${editing.id}`, {
          method: "PATCH",
          body: {
            name: String(fd.get("name") || "").trim(),
            hsn_code: String(fd.get("hsn_code") || "").trim() || null,
            gst_rate_bp: Math.round(Number(fd.get("gst_pct") || 5) * 100),
            selling_price_paise: priceRaw ? rupeesToPaise(priceRaw) : null,
            packets_per_carton: ppcRaw ? Number(ppcRaw) : null,
            shelf_life_days: shelfRaw ? Number(shelfRaw) : null,
            reorder_level: String(fd.get("reorder_level") || "0"),
          },
        });
        notify("Item updated");
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const canCreate = role === "ADMIN" || (role === "PRODUCTION" && kind !== "FINISHED");

  return (
    <div>
      <PageHeader
        eyebrow="MASTERS"
        title="Products & materials"
        description="Finished snacks, raw ingredients, and packaging materials."
        action={
          canCreate && (
            <Button icon="plus" onClick={() => setEditing("new")}>
              Add {kind.toLowerCase()}
            </Button>
          )
        }
      />

      <div className="tabs" role="tablist">
        {(["FINISHED", "RAW", "PACKAGING"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
            {k === "FINISHED" ? "Finished goods" : k === "RAW" ? "Raw materials" : "Packaging"}
          </button>
        ))}
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading items…" />}
      {!loading && items.length === 0 && (
        <EmptyState
          icon="box"
          title="No items"
          description={`No ${kind.toLowerCase()} items defined.`}
        />
      )}
      {!loading && items.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Unit</th>
                <th>HSN</th>
                <th className="number">GST</th>
                {kind === "FINISHED" && <th className="number">Price</th>}
                <th className="number">Reorder level</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.sku}</td>
                  <td>
                    <strong>{it.name}</strong>
                  </td>
                  <td>{it.display_unit}</td>
                  <td>{it.hsn_code || "—"}</td>
                  <td className="number">{it.gst_rate_bp / 100}%</td>
                  {kind === "FINISHED" && (
                    <td className="number">{formatMoney(it.selling_price_paise)}</td>
                  )}
                  <td className="number">
                    {it.reorder_level} {it.display_unit}
                  </td>
                  <td>
                    <Badge tone={it.is_active ? "success" : "neutral"}>
                      {it.is_active ? "ACTIVE" : "INACTIVE"}
                    </Badge>
                  </td>
                  <td>
                    {canCreate && (
                      <Button variant="secondary" onClick={() => setEditing(it)}>
                        Edit
                      </Button>
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
          title={editing === "new" ? `New ${kind.toLowerCase()} item` : `Edit ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={saveItem} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>
                  SKU <b>*</b>
                </span>
                <input
                  name="sku"
                  required
                  disabled={editing !== "new"}
                  defaultValue={editing === "new" ? "" : editing.sku}
                  className="w-full"
                />
              </label>
              <label>
                <span>
                  Unit <b>*</b>
                </span>
                {kind === "FINISHED" ? (
                  <input value="packet" disabled className="w-full" />
                ) : (
                  <select
                    name="display_unit"
                    disabled={editing !== "new"}
                    defaultValue={editing === "new" ? "kg" : editing.display_unit}
                    className="w-full"
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="l">l</option>
                    <option value="ml">ml</option>
                    <option value="pcs">pcs</option>
                  </select>
                )}
              </label>
            </div>
            <label className="block">
              <span>
                Name <b>*</b>
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
                <span>HSN Code</span>
                <input
                  name="hsn_code"
                  defaultValue={editing === "new" ? "" : editing.hsn_code || ""}
                  className="w-full"
                />
              </label>
              <label>
                <span>GST %</span>
                <input
                  name="gst_pct"
                  type="number"
                  step="0.1"
                  min={0}
                  max={40}
                  defaultValue={editing === "new" ? 5 : editing.gst_rate_bp / 100}
                  className="w-full"
                />
              </label>
            </div>
            {kind === "FINISHED" && (
              <div className="grid grid-cols-3 gap-3">
                <label>
                  <span>
                    Price (₹) <b>*</b>
                  </span>
                  <input
                    name="selling_price"
                    required
                    inputMode="decimal"
                    defaultValue={
                      editing === "new" ? "" : paiseToRupeesInput(editing.selling_price_paise)
                    }
                    className="w-full"
                  />
                </label>
                <label>
                  <span>Pkts / carton</span>
                  <input
                    name="packets_per_carton"
                    type="number"
                    min={1}
                    defaultValue={editing === "new" ? "" : editing.packets_per_carton || ""}
                    className="w-full"
                  />
                </label>
                <label>
                  <span>Shelf life (days)</span>
                  <input
                    name="shelf_life_days"
                    type="number"
                    min={1}
                    defaultValue={editing === "new" ? "90" : editing.shelf_life_days || ""}
                    className="w-full"
                  />
                </label>
              </div>
            )}
            <label className="block">
              <span>Reorder level</span>
              <input
                name="reorder_level"
                inputMode="decimal"
                defaultValue={editing === "new" ? "0" : editing.reorder_level}
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
    </div>
  );
}
