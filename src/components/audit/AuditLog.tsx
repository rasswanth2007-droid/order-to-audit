import { Fragment, useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, ErrorBanner, LoadingState, PageHeader } from "../ui";
import { api } from "@/services/api";
import { formatDateTime } from "@/utils/format";
import { useT } from "@/utils/i18n";

type AuditEntry = {
  id: number;
  ts: string;
  username: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  before: unknown;
  after: unknown;
};

const PAGE_SIZE = 50;

export function AuditLog() {
  const tr = useT();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [entityFilter, setEntityFilter] = useState("");
  const [usernameFilter, setUsernameFilter] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (entityFilter.trim()) qs.set("entity", entityFilter.trim());
      if (usernameFilter.trim()) qs.set("username", usernameFilter.trim());
      const res = await api<{ total: number; items: AuditEntry[] }>(`/audit?${qs.toString()}`);
      setItems(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [offset, entityFilter, usernameFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + items.length, total);

  return (
    <div>
      <PageHeader
        eyebrow="COMPLIANCE"
        title="Audit log"
        description="Immutable record of logins, approvals, stock movements and configuration changes."
        action={
          <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="filterbar">
        <input
          placeholder="Filter by entity (e.g. order, invoice, user)"
          value={entityFilter}
          onChange={(e) => {
            setEntityFilter(e.target.value);
            setOffset(0);
          }}
        />
        <input
          placeholder="Filter by username"
          value={usernameFilter}
          onChange={(e) => {
            setUsernameFilter(e.target.value);
            setOffset(0);
          }}
        />
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading audit log…" />}
      {!loading && items.length === 0 && (
        <EmptyState icon="shield" title="No audit entries match" />
      )}
      {!loading && items.length > 0 && (
        <>
          <div className="table-card overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>{tr("Timestamp")}</th>
                  <th>{tr("User")}</th>
                  <th>{tr("Action")}</th>
                  <th>{tr("Entity")}</th>
                  <th>{tr("Details")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <Fragment key={a.id}>
                    <tr>
                      <td>{formatDateTime(a.ts)}</td>
                      <td>{a.username || "—"}</td>
                      <td>
                        <Badge tone="info">{a.action}</Badge>
                      </td>
                      <td>
                        {a.entity || "—"} {a.entity_id ? `#${a.entity_id}` : ""}
                      </td>
                      <td>
                        {(a.before !== null || a.after !== null) && (
                          <Button
                            variant="ghost"
                            onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                          >
                            {expanded === a.id ? "Hide JSON" : "Inspect"}
                          </Button>
                        )}
                      </td>
                    </tr>
                    {expanded === a.id && (
                      <tr key={`${a.id}-json`}>
                        <td colSpan={5} className="bg-[#faf8f5]">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <div>
                              <strong>Before</strong>
                              <pre className="mt-1 p-2 bg-white border border-[var(--border)] rounded overflow-x-auto">
                                {JSON.stringify(a.before, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <strong>After</strong>
                              <pre className="mt-1 p-2 bg-white border border-[var(--border)] rounded overflow-x-auto">
                                {JSON.stringify(a.after, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <p>
              Showing {start}–{end} of {total}
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
                disabled={offset + PAGE_SIZE >= total}
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
