import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

type SettingsRes = {
  variance_tolerance_pct: string;
  company: {
    name?: string;
    gstin?: string;
    state_code?: string;
    state_name?: string;
    address?: string;
    phone?: string;
    email?: string;
    invoice_prefix?: string;
    bank?: string;
  };
};

export function Settings() {
  const { role, notify } = useAuth();
  const [data, setData] = useState<SettingsRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<SettingsRes>("/settings");
      setData(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await api<SettingsRes>("/settings", {
        method: "PUT",
        body: {
          variance_tolerance_pct: String(fd.get("variance_tolerance_pct") || "5"),
          company: {
            name: String(fd.get("name") || "").trim(),
            gstin: String(fd.get("gstin") || "")
              .trim()
              .toUpperCase(),
            state_code: String(fd.get("state_code") || "").trim(),
            state_name: String(fd.get("state_name") || "").trim(),
            phone: String(fd.get("phone") || "").trim(),
            email: String(fd.get("email") || "").trim(),
            address: String(fd.get("address") || "").trim(),
            bank: String(fd.get("bank") || "").trim(),
          },
        },
      });
      setData(res.data);
      notify("Settings saved");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Factory settings"
        description="Company profile for tax invoices and production variance thresholds."
      />
      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading settings…" />}

      {data && (
        <form onSubmit={save} className="card p-6 max-w-2xl space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label>
              <span>Company name</span>
              <input name="name" defaultValue={data.company.name || ""} className="w-full" />
            </label>
            <label>
              <span>Variance tolerance (%)</span>
              <input
                name="variance_tolerance_pct"
                type="number"
                step="0.1"
                min={0}
                max={100}
                defaultValue={data.variance_tolerance_pct}
                className="w-full"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label>
              <span>GSTIN</span>
              <input name="gstin" defaultValue={data.company.gstin || ""} className="w-full" />
            </label>
            <label>
              <span>State code</span>
              <input
                name="state_code"
                defaultValue={data.company.state_code || ""}
                className="w-full"
              />
            </label>
            <label>
              <span>State name</span>
              <input
                name="state_name"
                defaultValue={data.company.state_name || ""}
                className="w-full"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label>
              <span>Phone</span>
              <input name="phone" defaultValue={data.company.phone || ""} className="w-full" />
            </label>
            <label>
              <span>Email</span>
              <input name="email" defaultValue={data.company.email || ""} className="w-full" />
            </label>
          </div>
          <label className="block">
            <span>Factory address</span>
            <textarea
              name="address"
              rows={2}
              defaultValue={data.company.address || ""}
              className="w-full"
            />
          </label>
          <label className="block">
            <span>Bank details (printed on invoices)</span>
            <input name="bank" defaultValue={data.company.bank || ""} className="w-full" />
          </label>
          {role === "ADMIN" && (
            <div className="pt-2 flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
