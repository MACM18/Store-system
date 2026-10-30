"use client";

export type OfflineProduct = { id: string; name: string; sku: string; category: string; priceCents: number; stock: number; active: boolean };
export type OfflineSnapshot = {
  store: { id: string; name: string; currency: string; timezone: string };
  user: { id: string; name: string; role: "OWNER" | "MANAGER" | "CASHIER" };
  today: string;
  products: OfflineProduct[];
  cashDay: { status: string; openingCash: number } | null;
  savedAt: string;
};
export type OfflineSale = {
  id: string;
  storeId: string;
  userId: string;
  createdAt: string;
  businessDate: string;
  lines: Array<{ productId: string; name: string; priceCents: number; quantity: number }>;
  payments: { cash: number; card: number; bank: number };
  credit?: { customerName: string; customerPhone: string };
  state: "queued" | "synced" | "conflict";
  error?: string;
};

const DATABASE = "store-system-offline";
const VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Offline storage is not available in this browser"));
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
      if (!db.objectStoreNames.contains("sales")) db.createObjectStore("sales", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage"));
  });
}

async function transact<T>(storeName: "meta" | "sales", mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    let result!: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed"));
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Offline storage transaction failed")); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Offline storage transaction was cancelled")); };
  });
}

export function saveOfflineSnapshot(snapshot: OfflineSnapshot) {
  return transact("meta", "readwrite", (store) => store.put({ key: "snapshot", value: snapshot }));
}

export async function readOfflineSnapshot(): Promise<OfflineSnapshot | null> {
  const result = await transact<{ key: string; value: OfflineSnapshot } | undefined>("meta", "readonly", (store) => store.get("snapshot"));
  return result?.value ?? null;
}

export function saveOfflineSale(sale: OfflineSale) {
  return transact("sales", "readwrite", (store) => store.put(sale));
}

export async function queueOfflineSale(sale: Omit<OfflineSale, "state">) {
  await saveOfflineSale({ ...sale, state: "queued" });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("offline-sales-changed"));
}

export async function readOfflineSales(): Promise<OfflineSale[]> {
  return transact<OfflineSale[]>("sales", "readonly", (store) => store.getAll());
}

export function clearOfflineSales() {
  return transact("sales", "readwrite", (store) => store.clear());
}

export async function clearOfflineData() {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(["meta", "sales"], "readwrite");
    transaction.objectStore("meta").clear();
    transaction.objectStore("sales").clear();
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

export function clearOfflineSnapshot() {
  return transact("meta", "readwrite", (store) => store.delete("snapshot"));
}

let syncInProgress = false;
export async function synchronizeOfflineSales() {
  if (syncInProgress || typeof navigator === "undefined" || !navigator.onLine) return readOfflineSales();
  syncInProgress = true;
  try {
    const [allSales, snapshot] = await Promise.all([readOfflineSales(), readOfflineSnapshot()]);
    const queued = allSales.filter((sale) => sale.state === "queued" && sale.userId === snapshot?.user.id && sale.storeId === snapshot.store.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const sale of queued) {
      try {
        const response = await fetch("/api/offline/sales", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sale),
          cache: "no-store",
        });
        if (response.ok) {
          await saveOfflineSale({ ...sale, state: "synced", error: undefined });
        } else {
          const result = await response.json().catch(() => ({})) as { error?: string };
          const state = response.status >= 400 && response.status < 500 && response.status !== 401 ? "conflict" : "queued";
          await saveOfflineSale({ ...sale, state, error: result.error ?? (response.status === 401 ? "Sign in again to sync this sale." : "Could not sync this sale yet.") });
          if (state === "conflict" || response.status === 401 || response.status >= 500) break;
        }
      } catch {
        break;
      }
    }
  } finally {
    syncInProgress = false;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("offline-sales-changed"));
  }
  return readOfflineSales();
}
