import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, ErrorBanner, Icon, LoadingState, PageHeader } from "../ui";
import { ApiError, api } from "@/services/api";
import { formatMoney, initials } from "@/utils/format";
import { useAuth } from "@/context/AuthContext";
import { cacheSalesData, enqueueOrder, getCachedSalesData } from "@/utils/offlineQueue";

type Customer = {
  id: number;
  name: string;
  type: string;
  state_code: string;
};

type AvailItem = {
  item_id: number;
  name: string;
  available: number;
  price_paise: number | null;
};

type ItemMeta = {
  id: number;
  packets_per_carton: number | null;
};

export function NewOrder({ onViewOrders }: { onViewOrders?: () => void }) {
  const { notify } = useAuth();
  const [step, setStep] = useState(1);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<AvailItem[]>([]);
  const [cartonMap, setCartonMap] = useState<Record<number, number>>({});
  const [custQuery, setCustQuery] = useState("");
  const [itemQuery, setItemQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [units, setUnits] = useState<Record<number, "packet" | "carton">>({});
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [createdOrderNo, setCreatedOrderNo] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [custRes, availRes, itemsRes] = await Promise.all([
        api<Customer[]>("/customers"),
        api<AvailItem[]>("/availability"),
        api<ItemMeta[]>("/items?kind=FINISHED"),
      ]);
      setCustomers(custRes.data);
      setItems(availRes.data);
      const map: Record<number, number> = {};
      for (const it of itemsRes.data) {
        if (it.packets_per_carton) map[it.id] = it.packets_per_carton;
      }
      setCartonMap(map);
      await Promise.all([
        cacheSalesData("customers", custRes.data),
        cacheSalesData("availability", availRes.data),
        cacheSalesData("cartonMap", map),
      ]);
    } catch (err) {
      const [cachedCust, cachedAvail, cachedMap] = await Promise.all([
        getCachedSalesData<Customer[]>("customers"),
        getCachedSalesData<AvailItem[]>("availability"),
        getCachedSalesData<Record<number, number>>("cartonMap"),
      ]);
      if (cachedCust && cachedAvail) {
        setCustomers(cachedCust);
        setItems(cachedAvail);
        if (cachedMap) setCartonMap(cachedMap);
      } else {
        setError(err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredCustomers = useMemo(() => {
    const q = custQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, custQuery]);

  const filteredItems = useMemo(() => {
    const q = itemQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, itemQuery]);

  const selectedLines = useMemo(() => {
    return items
      .filter((i) => (qtys[i.item_id] || 0) > 0)
      .map((i) => {
        const qty = qtys[i.item_id] || 0;
        const unit = units[i.item_id] || "packet";
        const factor = unit === "carton" ? cartonMap[i.item_id] || 1 : 1;
        const packets = qty * factor;
        const estPaise = packets * (i.price_paise || 0);
        return { ...i, qty, unit, packets, estPaise };
      });
  }, [items, qtys, units, cartonMap]);

  const estimatedTotal = selectedLines.reduce((acc, l) => acc + l.estPaise, 0);

  async function submitOrder() {
    if (!selectedCustomer || selectedLines.length === 0) return;
    setBusy(true);
    setError(null);
    const clientRef =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ord-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const takenAt = new Date().toISOString();
    const lines = selectedLines.map((l) => ({
      item_id: l.item_id,
      qty: l.qty,
      unit: l.unit,
    }));

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await enqueueOrder({
        client_ref: clientRef,
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        lines,
        notes: notes.trim() || null,
        taken_at: takenAt,
        estimated_total_paise: estimatedTotal,
      });
      setSavedOffline(true);
      setBusy(false);
      notify("Saved on this phone — will send automatically");
      return;
    }

    try {
      const res = await api<{ order_no: string; duplicate?: boolean }>("/orders", {
        method: "POST",
        body: {
          customer_id: selectedCustomer.id,
          client_ref: clientRef,
          notes: notes.trim() || null,
          taken_at: takenAt,
          lines,
        },
      });
      setCreatedOrderNo(res.data.order_no);
      notify(
        res.data.duplicate
          ? `Order ${res.data.order_no} already received`
          : `Order ${res.data.order_no} submitted`,
      );
    } catch (err) {
      if (err instanceof ApiError && (err.code === "network_error" || err.code === "timeout")) {
        await enqueueOrder({
          client_ref: clientRef,
          customer_id: selectedCustomer.id,
          customer_name: selectedCustomer.name,
          lines,
          notes: notes.trim() || null,
          taken_at: takenAt,
          estimated_total_paise: estimatedTotal,
        });
        setSavedOffline(true);
        notify("Saved on this phone — will send automatically");
      } else {
        setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCreatedOrderNo(null);
    setSavedOffline(false);
    setStep(1);
    setSelectedCustomer(null);
    setQtys({});
    setUnits({});
    setNotes("");
  }

  if (createdOrderNo || savedOffline) {
    return (
      <div className="mobile-success">
        <span>
          <Icon name="check" size={34} />
        </span>
        <h1>{savedOffline ? "Saved on this phone" : "Order submitted"}</h1>
        <p>
          {savedOffline
            ? "Your order is queued and will send automatically when connectivity returns."
            : `${createdOrderNo} was received by the factory.`}
        </p>
        <Badge tone={savedOffline ? "warning" : "info"}>
          {savedOffline ? "WAITING TO SEND" : "SUBMITTED"}
        </Badge>
        <Button onClick={reset}>Start a new order</Button>
        {onViewOrders && (
          <Button variant="secondary" onClick={onViewOrders}>
            View my orders
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mobile-order">
      <PageHeader title="New order" description="Fast order capture in three steps." />
      <div className="mobile-steps">
        {["Customer", "Products", "Review"].map((x, i) => (
          <div className={step >= i + 1 ? "active" : ""} key={x}>
            <span>{step > i + 1 ? <Icon name="check" size={14} /> : i + 1}</span>
            <small>{x}</small>
          </div>
        ))}
      </div>

      <ErrorBanner error={error} onRetry={loadData} />
      {loading && <LoadingState label="Loading customers and products…" />}

      {!loading && step === 1 && (
        <section>
          <label className="search big">
            <Icon name="search" />
            <span className="sr-only">Search customers</span>
            <input
              placeholder="Search customers"
              value={custQuery}
              onChange={(e) => setCustQuery(e.target.value)}
            />
          </label>
          <p className="list-label">CUSTOMERS ({filteredCustomers.length})</p>
          {filteredCustomers.map((c) => (
            <button
              className="customer-row"
              key={c.id}
              onClick={() => {
                setSelectedCustomer(c);
                setStep(2);
              }}
            >
              <span className="avatar">{initials(c.name)}</span>
              <span>
                <strong>{c.name}</strong>
                <small>
                  {c.type} · State {c.state_code}
                </small>
              </span>
              <Icon name="chevron" />
            </button>
          ))}
        </section>
      )}

      {!loading && step === 2 && selectedCustomer && (
        <section>
          <div className="selected-customer">
            <span>
              <Icon name="check" />
            </span>
            <div>
              <small>ORDERING FOR</small>
              <strong>{selectedCustomer.name}</strong>
            </div>
            <button onClick={() => setStep(1)}>Change</button>
          </div>

          <label className="search big">
            <Icon name="search" />
            <span className="sr-only">Search products</span>
            <input
              placeholder="Search products"
              value={itemQuery}
              onChange={(e) => setItemQuery(e.target.value)}
            />
          </label>

          {filteredItems.map((it) => {
            const qty = qtys[it.item_id] || 0;
            const unit = units[it.item_id] || "packet";
            const hasCarton = Boolean(cartonMap[it.item_id]);
            const packets = qty * (unit === "carton" ? cartonMap[it.item_id] || 1 : 1);
            const exceeds = packets > it.available;
            return (
              <div className="product-card" key={it.item_id}>
                <div className="product-top">
                  <div className="product-art">
                    <Icon name="bag" />
                  </div>
                  <div>
                    <strong>{it.name}</strong>
                    <span>{formatMoney(it.price_paise)} / packet</span>
                    <small>{it.available} packets free</small>
                  </div>
                </div>
                {exceeds && (
                  <p className="text-xs text-[var(--warning)] mt-2 font-medium">
                    Only {it.available} packets free right now — the factory will confirm.
                  </p>
                )}
                <div className="product-controls">
                  <div className="unit-toggle">
                    <button
                      type="button"
                      className={unit === "packet" ? "active" : ""}
                      onClick={() => setUnits((p) => ({ ...p, [it.item_id]: "packet" }))}
                    >
                      Packet
                    </button>
                    {hasCarton && (
                      <button
                        type="button"
                        className={unit === "carton" ? "active" : ""}
                        onClick={() => setUnits((p) => ({ ...p, [it.item_id]: "carton" }))}
                      >
                        Carton ({cartonMap[it.item_id]})
                      </button>
                    )}
                  </div>
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => setQtys((p) => ({ ...p, [it.item_id]: Math.max(0, qty - 1) }))}
                    >
                      <Icon name="minus" />
                    </button>
                    <input
                      value={qty}
                      onChange={(e) =>
                        setQtys((p) => ({
                          ...p,
                          [it.item_id]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        }))
                      }
                      inputMode="numeric"
                      aria-label="Quantity"
                    />
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => setQtys((p) => ({ ...p, [it.item_id]: qty + 1 }))}
                    >
                      <Icon name="plus" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="mt-4 flex justify-between items-center card p-4">
            <div>
              <small className="text-[var(--muted)]">
                {selectedLines.length} item(s) · Est. {formatMoney(estimatedTotal)}
              </small>
            </div>
            <Button disabled={selectedLines.length === 0} onClick={() => setStep(3)}>
              Review order
            </Button>
          </div>
        </section>
      )}

      {!loading && step === 3 && selectedCustomer && (
        <section className="space-y-4">
          <div className="card p-4">
            <p className="eyebrow">CUSTOMER</p>
            <strong>{selectedCustomer.name}</strong>
          </div>
          <div className="card p-4 space-y-2">
            <p className="eyebrow">ITEMS</p>
            {selectedLines.map((l) => (
              <div
                key={l.item_id}
                className="flex justify-between text-sm py-1 border-b border-[var(--border)]"
              >
                <span>
                  {l.name} ({l.qty} {l.unit})
                </span>
                <strong>{formatMoney(l.estPaise)}</strong>
              </div>
            ))}
            <div className="flex justify-between pt-2 font-semibold">
              <span>Estimate (server decides final price)</span>
              <strong>{formatMoney(estimatedTotal)}</strong>
            </div>
          </div>
          <label className="block">
            <span>Delivery / order note</span>
            <textarea
              rows={2}
              maxLength={255}
              className="w-full"
              placeholder="Optional note for the factory"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button className="flex-1" disabled={busy} onClick={submitOrder}>
              {busy ? "Submitting…" : "Submit order"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
