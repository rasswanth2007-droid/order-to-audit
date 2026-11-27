import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/utils/i18n";

type Supplier = {
  id: number;
  name: string;
  gstin: string | null;
  state_code: string | null;
  phone: string | null;
  address: string | null;
  is_active: boolean;
};

export function Suppliers() {
  const { role, notify } = useAuth();
  const tr = useT();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<Supplier[]>("/suppliers");
      setSuppliers(res.data);
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
      await api("/suppliers", {
        method: "POST",
        body: {
          name: String(fd.get("name") || "").trim(),
          gstin:
            String(fd.get("gstin") || "")
              .trim()
              .toUpperCase() || null,
          state_code: String(fd.get("state_code") || "").trim() || null,
          phone: String(fd.get("phone") || "").trim() || null,
          address: String(fd.get("address") || "").trim() || null,
          is_active: true,
        },
      });
      setOpen(false);
      notify("Supplier created");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const canCreate = role === "ADMIN" || role === "PRODUCTION";

  return (
    <div>
      <PageHeader
        eyebrow="MASTERS"
        title="Suppliers"
        description="Vendors for raw materials and packaging."
        action={
          canCreate && (
            <Button icon="plus" onClick={() => setOpen(true)}>
              Add supplier
            </Button>
          )
        }
      />
      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading suppliers…" />}
      {!loading && suppliers.length === 0 && (
        <EmptyState icon="factory" title="No suppliers" description="Add your first supplier." />
      )}
      {!loading && suppliers.length > 0 && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{tr("Name")}</th>
                <th>{tr("GSTIN")}</th>
                <th>{tr("State")}</th>
                <th>{tr("Phone")}</th>
                <th>{tr("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>{s.gstin || "Unregistered"}</td>
                  <td>{s.state_code || "—"}</td>
                  <td>{s.phone || "—"}</td>
                  <td>
                    <Badge tone={s.is_active ? "success" : "neutral"}>
                      {s.is_active ? "ACTIVE" : "INACTIVE"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Dialog title="New supplier" onClose={() => setOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <label className="block">
              <span>
                Supplier name <b>*</b>
              </span>
              <input name="name" required className="w-full" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span>GSTIN</span>
                <input name="gstin" placeholder="33AAAAA0000A1Z5" className="w-full" />
              </label>
              <label>
                <span>State code</span>
                <input name="state_code" pattern="^[0-9]{2}$" placeholder="33" className="w-full" />
              </label>
            </div>
            <label className="block">
              <span>Phone</span>
              <input name="phone" className="w-full" />
            </label>
            <label className="block">
              <span>Address</span>
              <textarea name="address" rows={2} className="w-full" />
            </label>
            <div className="dialog-actions">
              <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save supplier"}
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
