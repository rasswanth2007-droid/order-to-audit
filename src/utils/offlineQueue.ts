import { api } from "@/services/api";

export type QueuedOrder = {
  client_ref: string;
  customer_id: number;
  customer_name: string;
  lines: Array<{ item_id: number; qty: number; unit: "packet" | "carton" }>;
  notes: string | null;
  taken_at: string;
  estimated_total_paise: number;
  last_error?: string;
};

const DB_NAME = "o2a_offline_v1";
const STORE_ORDERS = "orders";
const STORE_CACHE = "cache";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ORDERS)) {
        db.createObjectStore(STORE_ORDERS, { keyPath: "client_ref" });
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOrder(order: QueuedOrder): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ORDERS, "readwrite");
    tx.objectStore(STORE_ORDERS).put(order);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedOrders(): Promise<QueuedOrder[]> {
  try {
    const db = await openDb();
    return await new Promise<QueuedOrder[]>((resolve, reject) => {
      const tx = db.transaction(STORE_ORDERS, "readonly");
      const req = tx.objectStore(STORE_ORDERS).getAll();
      req.onsuccess = () => resolve((req.result as QueuedOrder[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function removeQueuedOrder(clientRef: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_ORDERS, "readwrite");
    tx.objectStore(STORE_ORDERS).delete(clientRef);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function cacheSalesData(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, "readwrite");
      tx.objectStore(STORE_CACHE).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore cache write errors
  }
}

export async function getCachedSalesData<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_CACHE, "readonly");
      const req = tx.objectStore(STORE_CACHE).get(key);
      req.onsuccess = () => resolve((req.result as { value?: T } | undefined)?.value ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function syncQueuedOrders(): Promise<{ sent: number; failed: number }> {
  const queued = await listQueuedOrders();
  if (queued.length === 0) return { sent: 0, failed: 0 };

  const res = await api<{
    results: Array<{ client_ref: string; ok: boolean; error?: string }>;
  }>("/orders/sync", {
    method: "POST",
    body: {
      orders: queued.map((q) => ({
        customer_id: q.customer_id,
        client_ref: q.client_ref,
        lines: q.lines,
        notes: q.notes,
        taken_at: q.taken_at,
      })),
    },
  });

  let sent = 0;
  let failed = 0;
  for (const r of res.data.results) {
    if (r.ok) {
      await removeQueuedOrder(r.client_ref);
      sent += 1;
    } else {
      const match = queued.find((q) => q.client_ref === r.client_ref);
      if (match) {
        await enqueueOrder({ ...match, last_error: r.error || "Sync failed" });
      }
      failed += 1;
    }
  }
  return { sent, failed };
}
