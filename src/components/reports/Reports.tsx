import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  ErrorBanner,
  Icon,
  LoadingState,
  PageHeader,
  Stat,
  type IconName,
} from "../ui";
import { api, apiDownload } from "@/services/api";
import { formatDate, formatMoney, todayISO } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";

type ReportCol = { key: string; label: string; kind: string };
type ReportSection = {
  title: string;
  columns: ReportCol[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown> | null;
};
type ReportJson = {
  key: string;
  title: string;
  period: string;
  classification?: string;
  company?: {
    name?: string;
    gstin?: string;
    address?: string;
    phone?: string;
    email?: string;
  } | null;
  sections: ReportSection[];
  notes?: string[];
};
type CatalogueRes = {
  reports: string[];
  formats: string[];
  production_role_can_see: string[];
};

const REPORT_META: Record<string, { title: string; desc: string; icon: IconName }> = {
  "sales-register": {
    title: "Sales register",
    desc: "All issued and cancelled invoices",
    icon: "file",
  },
  "customer-sales": {
    title: "Customer-wise sales",
    desc: "Sales grouped by customer",
    icon: "users",
  },
  "product-sales": {
    title: "Product-wise sales",
    desc: "Quantity and value by product",
    icon: "box",
  },
  "gst-summary": { title: "GST summary", desc: "GSTR-1 and 3B summaries", icon: "shield" },
  "purchase-register": {
    title: "Purchase register",
    desc: "Taxable purchases and GST",
    icon: "bag",
  },
  "stock-summary": { title: "Stock summary", desc: "Quantity and value on hand", icon: "box" },
  "stock-ledger": { title: "Stock ledger", desc: "Every inventory movement", icon: "file" },
  "production-report": {
    title: "Production report",
    desc: "Planned output and actual yield",
    icon: "factory",
  },
  collections: { title: "Collections", desc: "Payments received by mode", icon: "trend" },
  outstanding: { title: "Outstanding with ageing", desc: "Open customer balances", icon: "clock" },
  "cost-per-packet": {
    title: "Cost per packet",
    desc: "Materials, overheads and margin",
    icon: "trend",
  },
  "batch-stock": {
    title: "Finished goods by batch",
    desc: "Available lots and expiry",
    icon: "box",
  },
};

function monthStartISO(offsetMonths = 0): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + offsetMonths;
  const start = new Date(y, m, 1);
  const end = offsetMonths === 0 ? now : new Date(y, m + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(start), to: fmt(end) };
}

function fyRangeISO(): { from: string; to: string } {
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${fyStartYear}-04-01`, to: todayISO() };
}

function formatCell(value: unknown, kind: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return formatMoney(value as number | string);
  if (kind === "date") return formatDate(String(value));
  if (kind === "int" || kind === "num") {
    const n = Number(value);
    return Number.isNaN(n) ? String(value) : n.toLocaleString("en-IN");
  }
  return String(value);
}

function ReportDetail({ reportKey, onBack }: { reportKey: string; onBack: () => void }) {
  const { notify } = useAuth();
  const initial = monthStartISO(0);
  const [preset, setPreset] = useState<"this" | "last" | "fy" | "custom">("this");
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [applied, setApplied] = useState({ from: initial.from, to: initial.to });
  const [data, setData] = useState<ReportJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        format: "json",
        from_date: applied.from,
        to_date: applied.to,
      });
      const res = await api<ReportJson>(`/reports/${reportKey}?${qs.toString()}`);
      setData(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [reportKey, applied]);

  useEffect(() => {
    load();
  }, [load]);

  function applyPreset(p: "this" | "last" | "fy") {
    setPreset(p);
    const r = p === "this" ? monthStartISO(0) : p === "last" ? monthStartISO(-1) : fyRangeISO();
    setFromDate(r.from);
    setToDate(r.to);
    setApplied(r);
  }

  async function handleExport(fmt: "csv" | "xlsx" | "pdf") {
    setDownloading(fmt);
    try {
      const qs = new URLSearchParams({
        format: fmt,
        from_date: applied.from,
        to_date: applied.to,
      });
      await apiDownload(`/reports/${reportKey}?${qs.toString()}`, `${reportKey}.${fmt}`);
      notify(`Downloaded ${reportKey}.${fmt}`);
    } catch (err) {
      setError(err);
    } finally {
      setDownloading(null);
    }
  }

  const meta = REPORT_META[reportKey] ?? { title: reportKey, desc: "", icon: "file" as IconName };
  const firstTotals = data?.sections?.[0]?.totals;

  return (
    <div>
      <button className="back-link" onClick={onBack}>
        ‹ All reports
      </button>
      <PageHeader
        eyebrow="REPORT"
        title={data?.title || meta.title}
        description={data?.period || `${formatDate(applied.from)} to ${formatDate(applied.to)}`}
        action={
          <div className="header-actions flex-wrap">
            <Button
              variant="secondary"
              icon="download"
              disabled={downloading !== null}
              onClick={() => handleExport("csv")}
            >
              {downloading === "csv" ? "Exporting…" : "CSV"}
            </Button>
            <Button
              variant="secondary"
              icon="download"
              disabled={downloading !== null}
              onClick={() => handleExport("xlsx")}
            >
              {downloading === "xlsx" ? "Exporting…" : "Excel"}
            </Button>
            <Button
              icon="download"
              disabled={downloading !== null}
              onClick={() => handleExport("pdf")}
            >
              {downloading === "pdf" ? "Exporting…" : "PDF"}
            </Button>
          </div>
        }
      />
      <div className="datebar">
        <div className="preset">
          <button className={preset === "this" ? "active" : ""} onClick={() => applyPreset("this")}>
            This month
          </button>
          <button className={preset === "last" ? "active" : ""} onClick={() => applyPreset("last")}>
            Last month
          </button>
          <button className={preset === "fy" ? "active" : ""} onClick={() => applyPreset("fy")}>
            This FY
          </button>
          <button
            className={preset === "custom" ? "active" : ""}
            onClick={() => setPreset("custom")}
          >
            Custom
          </button>
        </div>
        <label>
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setPreset("custom");
              setFromDate(e.target.value);
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setPreset("custom");
              setToDate(e.target.value);
            }}
          />
        </label>
        <Button variant="secondary" onClick={() => setApplied({ from: fromDate, to: toDate })}>
          Apply
        </Button>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label={`Loading ${meta.title}…`} />}

      {!loading && data && (
        <>
          {firstTotals && Object.keys(firstTotals).length > 0 && (
            <div className="stats">
              {Object.entries(firstTotals)
                .slice(0, 4)
                .map(([k, v]) => {
                  const col = data.sections[0].columns.find((c) => c.key === k);
                  return (
                    <Stat
                      key={k}
                      label={col?.label || k}
                      value={formatCell(v, col?.kind || "text")}
                    />
                  );
                })}
            </div>
          )}

          {data.sections.map((sec) => (
            <div className="table-card mb-6 overflow-x-auto" key={sec.title}>
              <div className="table-title">
                <h2>{sec.title}</h2>
                <Badge>{sec.rows.length} ROWS</Badge>
              </div>
              {sec.rows.length === 0 ? (
                <p className="p-6 text-sm text-[var(--muted)]">
                  No records in this section for the selected period.
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      {sec.columns.map((c) => (
                        <th
                          key={c.key}
                          className={
                            c.kind === "money" || c.kind === "int" || c.kind === "num"
                              ? "number"
                              : ""
                          }
                        >
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((row, idx) => (
                      <tr key={idx}>
                        {sec.columns.map((c) => (
                          <td
                            key={c.key}
                            className={
                              c.kind === "money" || c.kind === "int" || c.kind === "num"
                                ? "number"
                                : ""
                            }
                          >
                            {formatCell(row[c.key], c.kind)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {sec.totals && Object.keys(sec.totals).length > 0 && (
                    <tfoot>
                      <tr className="bg-[#f4f1ed] font-semibold">
                        {sec.columns.map((c, idx) => {
                          const hasTotal = c.key in (sec.totals || {});
                          return (
                            <td
                              key={c.key}
                              className={
                                c.kind === "money" || c.kind === "int" || c.kind === "num"
                                  ? "number"
                                  : ""
                              }
                            >
                              {hasTotal
                                ? formatCell(sec.totals?.[c.key], c.kind)
                                : idx === 0
                                  ? "Total"
                                  : ""}
                            </td>
                          );
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          ))}

          {data.notes && data.notes.length > 0 && (
            <div className="report-note">
              <Icon name="file" />
              <div>
                <strong>Notes</strong>
                {data.notes.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Reports() {
  const { role } = useAuth();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [keys, setKeys] = useState<string[]>(Object.keys(REPORT_META));
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let active = true;
    api<CatalogueRes>("/reports")
      .then((res) => {
        if (!active) return;
        const list = role === "PRODUCTION" ? res.data.production_role_can_see : res.data.reports;
        setKeys(list);
      })
      .catch((err) => {
        if (active) setError(err);
      });
    return () => {
      active = false;
    };
  }, [role]);

  if (openKey) return <ReportDetail reportKey={openKey} onBack={() => setOpenKey(null)} />;

  return (
    <div>
      <PageHeader
        eyebrow="REPORTING"
        title="Reports"
        description="Clear, export-ready records for sales, tax, stock and production."
        action={
          role !== "PRODUCTION" && (
            <Button
              variant="secondary"
              icon="download"
              onClick={() => apiDownload("/reports/tally-xml", "tally-vouchers.xml")}
            >
              Tally XML
            </Button>
          )
        }
      />
      <ErrorBanner error={error} />
      {role !== "PRODUCTION" && (
        <div className="report-feature">
          <div className="feature-icon">
            <Icon name="trend" size={26} />
          </div>
          <div>
            <span>QUICK VIEW</span>
            <h2>Business overview</h2>
            <p>Start with this month's sales register, GST summary and collections.</p>
          </div>
          <Button onClick={() => setOpenKey("sales-register")}>Open sales register</Button>
        </div>
      )}
      <h2 className="section-title">All reports</h2>
      <div className="report-grid">
        {keys.map((k) => {
          const meta = REPORT_META[k] ?? { title: k, desc: "", icon: "file" as IconName };
          return (
            <button key={k} className="report-card" onClick={() => setOpenKey(k)}>
              <span className="report-icon">
                <Icon name={meta.icon} />
              </span>
              <span>
                <strong>{meta.title}</strong>
                <small>{meta.desc}</small>
              </span>
              <Icon name="chevron" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
