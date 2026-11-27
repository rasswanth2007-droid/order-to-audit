import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

type BomLine = { item_id: number; name: string; kind: string; qty: string; unit: string };
type Bom = {
  product_id: number;
  product: string;
  yield_qty: number;
  version: number;
  lines: BomLine[];
};
type ItemOpt = { id: number; name: string; kind: string; display_unit: string };

export function BomEditor() {
  const { role, notify } = useAuth();
  const [boms, setBoms] = useState<Bom[]>([]);
  const [finished, setFinished] = useState<ItemOpt[]>([]);
  const [materials, setMaterials] = useState<ItemOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{
    product_id: number;
    product: string;
    yield_qty: string;
    lines: Array<{ item_id: string; qty: string; unit: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bomRes, itemRes] = await Promise.all([api<Bom[]>("/boms"), api<ItemOpt[]>("/items")]);
      setBoms(bomRes.data);
      setFinished(itemRes.data.filter((i) => i.kind === "FINISHED"));
      setMaterials(itemRes.data.filter((i) => i.kind !== "FINISHED"));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(b: Bom) {
    setEditing({
      product_id: b.product_id,
      product: b.product,
      yield_qty: String(b.yield_qty),
      lines: b.lines.map((l) => ({ item_id: String(l.item_id), qty: l.qty, unit: l.unit })),
    });
  }

  function startNew(product: ItemOpt) {
    setEditing({
      product_id: product.id,
      product: product.name,
      yield_qty: "200",
      lines: [{ item_id: "", qty: "", unit: "kg" }],
    });
  }

  async function saveBom(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/boms/${editing.product_id}`, {
        method: "PUT",
        body: {
          yield_qty: Number(editing.yield_qty),
          lines: editing.lines
            .filter((l) => l.item_id && Number(l.qty) > 0)
            .map((l) => ({ item_id: Number(l.item_id), qty: Number(l.qty), unit: l.unit })),
        },
      });
      setEditing(null);
      notify("Bill of materials saved");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const missingBomProducts = finished.filter((f) => !boms.some((b) => b.product_id === f.id));

  return (
    <div>
      <PageHeader
        eyebrow="RECIPES"
        title="Bill of materials"
        description="Standard ingredient & packaging quantities per batch."
      />
      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading BOMs…" />}

      {!loading && boms.length === 0 && (
        <EmptyState
          icon="file"
          title="No BOMs defined"
          description="Define recipes for your finished products."
        />
      )}

      {!loading && (
        <div className="space-y-4">
          {boms.map((b) => (
            <div key={b.product_id} className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3>{b.product}</h3>
                  <p className="text-xs text-[var(--muted)]">
                    Batch yield: {b.yield_qty} packets · Version {b.version}
                  </p>
                </div>
                {role === "ADMIN" && (
                  <Button variant="secondary" onClick={() => startEdit(b)}>
                    Edit BOM
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {b.lines.map((l) => (
                  <div
                    key={l.item_id}
                    className="flex justify-between text-sm p-2 rounded bg-[#faf8f5] border border-[var(--border)]"
                  >
                    <span>{l.name}</span>
                    <strong>
                      {l.qty} {l.unit}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {role === "ADMIN" && missingBomProducts.length > 0 && (
            <div className="card p-5">
              <h3 className="mb-2">Products without BOM</h3>
              <div className="flex flex-wrap gap-2">
                {missingBomProducts.map((p) => (
                  <Button key={p.id} variant="secondary" icon="plus" onClick={() => startNew(p)}>
                    Define BOM for {p.name}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {editing && (
        <Dialog title={`BOM: ${editing.product}`} onClose={() => setEditing(null)}>
          <form onSubmit={saveBom} className="space-y-4">
            <label className="block">
              <span>
                Batch yield (packets) <b>*</b>
              </span>
              <input
                type="number"
                min={1}
                required
                value={editing.yield_qty}
                onChange={(e) => setEditing({ ...editing, yield_qty: e.target.value })}
                className="w-full"
              />
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Ingredients & Packaging</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    setEditing({
                      ...editing,
                      lines: [...editing.lines, { item_id: "", qty: "", unit: "kg" }],
                    })
                  }
                >
                  + Add line
                </Button>
              </div>
              {editing.lines.map((ln, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    className="col-span-6"
                    required
                    value={ln.item_id}
                    onChange={(e) => {
                      const it = materials.find((m) => String(m.id) === e.target.value);
                      setEditing({
                        ...editing,
                        lines: editing.lines.map((r, i) =>
                          i === idx
                            ? { ...r, item_id: e.target.value, unit: it?.display_unit || r.unit }
                            : r,
                        ),
                      });
                    }}
                  >
                    <option value="">Select material…</option>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.display_unit})
                      </option>
                    ))}
                  </select>
                  <input
                    className="col-span-3"
                    placeholder="Qty"
                    required
                    inputMode="decimal"
                    value={ln.qty}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        lines: editing.lines.map((r, i) =>
                          i === idx ? { ...r, qty: e.target.value } : r,
                        ),
                      })
                    }
                  />
                  <Badge>{ln.unit}</Badge>
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save BOM"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
