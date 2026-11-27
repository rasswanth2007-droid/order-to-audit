import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import type { Role, UserInfo } from "@/types";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/utils/i18n";

const ROLES: Role[] = ["ADMIN", "SALESMAN", "PRODUCTION", "ACCOUNTANT", "OWNER"];

export function Users() {
  const { notify } = useAuth();
  const tr = useT();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<UserInfo | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<UserInfo[]>("/users");
      setUsers(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    try {
      if (editing === "new") {
        await api("/users", {
          method: "POST",
          body: {
            username: String(fd.get("username") || "").trim(),
            full_name: String(fd.get("full_name") || "").trim(),
            role: String(fd.get("role")),
            password: String(fd.get("password") || ""),
          },
        });
        notify("User created");
      } else if (editing) {
        const newPwd = String(fd.get("new_password") || "");
        await api(`/users/${editing.id}`, {
          method: "PATCH",
          body: {
            full_name: String(fd.get("full_name") || "").trim(),
            role: String(fd.get("role")),
            is_active: fd.get("is_active") === "on",
            ...(newPwd ? { new_password: newPwd } : {}),
          },
        });
        notify("User updated");
      }
      setEditing(null);
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
        eyebrow="ADMINISTRATION"
        title="Users & roles"
        description="Manage factory staff accounts and role permissions."
        action={
          <Button icon="plus" onClick={() => setEditing("new")}>
            Add user
          </Button>
        }
      />

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading users…" />}
      {!loading && (
        <div className="table-card overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{tr("Username")}</th>
                <th>{tr("Full name")}</th>
                <th>{tr("Role")}</th>
                <th>{tr("Status")}</th>
                <th>{tr("Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.username}</strong>
                  </td>
                  <td>{u.full_name}</td>
                  <td>
                    <Badge tone="primary">{u.role}</Badge>
                  </td>
                  <td>
                    <Badge tone={u.is_active ? "success" : "danger"}>
                      {u.is_active ? "ACTIVE" : "DISABLED"}
                    </Badge>
                  </td>
                  <td>
                    <Button variant="secondary" onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Dialog
          title={editing === "new" ? "Create user" : `Edit ${editing.username}`}
          onClose={() => setEditing(null)}
        >
          <form onSubmit={saveUser} className="space-y-4">
            {editing === "new" && (
              <label className="block">
                <span>
                  Username <b>*</b>
                </span>
                <input
                  name="username"
                  required
                  minLength={3}
                  pattern="^[A-Za-z0-9_.-]+$"
                  className="w-full"
                />
              </label>
            )}
            <label className="block">
              <span>
                Full name <b>*</b>
              </span>
              <input
                name="full_name"
                required
                defaultValue={editing === "new" ? "" : editing.full_name}
                className="w-full"
              />
            </label>
            <label className="block">
              <span>Role</span>
              <select
                name="role"
                defaultValue={editing === "new" ? "SALESMAN" : editing.role}
                className="w-full"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            {editing === "new" ? (
              <label className="block">
                <span>
                  Password (min 10 chars) <b>*</b>
                </span>
                <input name="password" type="password" required minLength={10} className="w-full" />
              </label>
            ) : (
              <>
                <label className="block">
                  <span>Reset password (leave blank to keep current)</span>
                  <input name="new_password" type="password" minLength={10} className="w-full" />
                </label>
                <label className="flex items-center gap-2">
                  <input
                    name="is_active"
                    type="checkbox"
                    defaultChecked={editing.is_active}
                    className="min-h-0"
                  />
                  <span>Account active</span>
                </label>
              </>
            )}
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
