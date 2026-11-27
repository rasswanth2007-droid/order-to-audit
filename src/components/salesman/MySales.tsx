import { useCallback, useEffect, useState } from "react";
import { Badge, Button, EmptyState, ErrorBanner, LoadingState, PageHeader, Stat } from "../ui";
import { api } from "@/services/api";
import { formatMoney, todayISO } from "@/utils/format";
import { statusTone } from "@/utils/helpers";

type MySalesRes = {
  customers: Array<{
    customer_id: number;
    customer: string;
    orders: number;
    value_paise: number;
  }>;
  total_value_paise: number;
  orders_by_status: Record<string, number>;
};

export function MySales() {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const [fromDate, setFromDate] = useState(monthStart);
  const [toDate, setToDate] = useState(todayISO());
  const [data, setData] = useState<MySalesRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (fromDate) qs.set("from_date", fromDate);
      if (toDate) qs.set("to_date", toDate);
      const res = await api<MySalesRes>(`/me/sales?${qs.toString()}`);
      setData(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="My sales"
        description="Approved, invoiced and dispatched orders by customer."
        action={
          <Button variant="secondary" icon="refresh" onClick={load} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="datebar">
        <label>
          From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <Button variant="secondary" onClick={load}>
          Apply
        </Button>
      </div>

      <ErrorBanner error={error} onRetry={load} />
      {loading && <LoadingState label="Loading sales summary…" />}

      {!loading && data && (
        <>
          <div className="stats">
            <Stat
              label="Total approved sales"
              value={formatMoney(data.total_value_paise)}
              note={`${data.customers.reduce((a, c) => a + c.orders, 0)} orders`}
            />
          </div>

          {Object.keys(data.orders_by_status).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(data.orders_by_status).map(([st, count]) => (
                <Badge key={st} tone={statusTone(st)}>
                  {st}: {count}
                </Badge>
              ))}
            </div>
          )}

          {data.customers.length === 0 ? (
            <EmptyState
              icon="trend"
              title="No approved sales in this period"
              description="Submitted orders appear here once approved by the factory."
            />
          ) : (
            <div className="table-card overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="number">Orders</th>
                    <th className="number">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map((c) => (
                    <tr key={c.customer_id}>
                      <td>
                        <strong>{c.customer}</strong>
                      </td>
                      <td className="number">{c.orders}</td>
                      <td className="number">
                        <strong>{formatMoney(c.value_paise)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
