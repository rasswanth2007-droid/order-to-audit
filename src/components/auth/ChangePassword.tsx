import { useState, type FormEvent } from "react";
import { Button, ErrorBanner, PageHeader } from "../ui";
import { api, setAccessToken } from "@/services/api";
import { useAuth } from "@/context/AuthContext";

export function ChangePassword() {
  const { notify } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const current_password = String(fd.get("current_password") || "");
    const new_password = String(fd.get("new_password") || "");
    const confirm = String(fd.get("confirm_password") || "");
    if (new_password !== confirm) {
      setError(new Error("New password and confirmation do not match"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ access_token: string }>("/auth/change-password", {
        method: "POST",
        body: { current_password, new_password },
      });
      setAccessToken(res.data.access_token);
      e.currentTarget.reset();
      notify("Password updated");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="ACCOUNT"
        title="Change password"
        description="Update your password. Other active sessions will be signed out."
      />
      <ErrorBanner error={error} />
      <form onSubmit={submit} className="card p-6 max-w-md space-y-4">
        <label className="block">
          <span>
            Current password <b>*</b>
          </span>
          <input name="current_password" type="password" required className="w-full" />
        </label>
        <label className="block">
          <span>
            New password (min 10 characters) <b>*</b>
          </span>
          <input name="new_password" type="password" required minLength={10} className="w-full" />
        </label>
        <label className="block">
          <span>
            Confirm new password <b>*</b>
          </span>
          <input
            name="confirm_password"
            type="password"
            required
            minLength={10}
            className="w-full"
          />
        </label>
        <Button type="submit" disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
    </div>
  );
}
