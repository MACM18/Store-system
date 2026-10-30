"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { businessDate } from "@/lib/dates";
import { formatMoney, moneyInputStep } from "@/lib/money";
import { OfflineProduct, OfflineSale, OfflineSnapshot, queueOfflineSale, readOfflineSales, readOfflineSnapshot, synchronizeOfflineSales } from "@/lib/offline-store";
import { FiArrowLeft, FiCheck, FiRefreshCw, FiWifi, FiWifiOff } from "react-icons/fi";

function useConnection() {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  return online;
}

export function OfflineCounter() {
  const online = useConnection();
  const [snapshot, setSnapshot] = useState<OfflineSnapshot | null>(null);
  const [sales, setSales] = useState<OfflineSale[]>([]);
  const [orphanedSalesCount, setOrphanedSalesCount] = useState(0);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payments, setPayments] = useState({ cash: 0, card: 0, bank: 0 });
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const [cached, records] = await Promise.all([readOfflineSnapshot().catch(() => null), readOfflineSales().catch(() => [])]);
    setSnapshot(cached);
    setSales(cached ? records.filter((sale) => sale.userId === cached.user.id && sale.storeId === cached.store.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []);
    setOrphanedSalesCount(cached ? 0 : records.filter((sale) => sale.state !== "synced").length);
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const changed = () => { void refresh(); };
    window.addEventListener("offline-sales-changed", changed);
    window.addEventListener("online", changed);
    return () => { window.removeEventListener("offline-sales-changed", changed); window.removeEventListener("online", changed); };
  }, [refresh]);

  const sync = useCallback(async () => {
    const updated = await synchronizeOfflineSales();
    setSales(updated.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, []);
  useEffect(() => { if (online) void Promise.resolve().then(sync); }, [online, sync]);

  const products = snapshot?.products ?? [];
  const digits = snapshot ? new Intl.NumberFormat("en", { style: "currency", currency: snapshot.store.currency }).resolvedOptions().maximumFractionDigits ?? 2 : 2;
  const factor = 10 ** digits;
  const step = snapshot ? moneyInputStep(snapshot.store.currency) : 0.01;
  const inProgressSales = sales.filter((sale) => sale.createdAt > (snapshot?.savedAt ?? ""));
  const stockSold = useMemo(() => {
    const sold: Record<string, number> = {};
    for (const sale of inProgressSales) for (const line of sale.lines) sold[line.productId] = (sold[line.productId] ?? 0) + line.quantity;
    return sold;
  }, [inProgressSales]);
  const availableProducts = products.filter((product) => product.active && product.stock - (stockSold[product.id] ?? 0) > 0);
  const total = products.reduce((sum, product) => sum + product.priceCents * (cart[product.id] ?? 0), 0);
  const queuedCount = sales.filter((sale) => sale.state === "queued").length;
  const conflictCount = sales.filter((sale) => sale.state === "conflict").length;

  function add(product: OfflineProduct, delta: number) {
    const available = product.stock - (stockSold[product.id] ?? 0);
    const next = { ...cart };
    const quantity = Math.max(0, Math.min(available, (cart[product.id] ?? 0) + delta));
    if (quantity) next[product.id] = quantity; else delete next[product.id];
    setCart(next);
    const nextTotal = products.reduce((sum, item) => sum + item.priceCents * (next[item.id] ?? 0), 0);
    setPayments({ cash: nextTotal, card: 0, bank: 0 });
  }

  async function saveSale() {
    if (!snapshot || !Object.keys(cart).length || saving) return;
    if (!snapshot.cashDay || snapshot.cashDay.status !== "OPEN") {
      setNotice("Open today’s drawer while online before taking sales offline.");
      return;
    }
    if (payments.cash + payments.card + payments.bank !== total) {
      setNotice("Payment amounts must match the sale total.");
      return;
    }
    setSaving(true);
    const createdAt = new Date().toISOString();
    const saleDate = businessDate(snapshot.store.timezone, new Date(createdAt));
    if (saleDate !== snapshot.today) {
      setNotice("The store day has changed. Reconnect and open the new day’s drawer before taking more sales.");
      setSaving(false);
      return;
    }
    const record: Omit<OfflineSale, "state"> = {
      id: crypto.randomUUID(),
      storeId: snapshot.store.id,
      userId: snapshot.user.id,
      createdAt,
      businessDate: saleDate,
      lines: products.filter((product) => cart[product.id]).map((product) => ({ productId: product.id, name: product.name, priceCents: product.priceCents, quantity: cart[product.id] })),
      payments,
    };
    try {
      await queueOfflineSale(record);
      setCart({});
      setPayments({ cash: 0, card: 0, bank: 0 });
      setNotice(online ? "Sale saved on this device. Syncing it now…" : "Sale saved on this device and will sync when you’re back online.");
      await refresh();
      if (online) {
        const result = await synchronizeOfflineSales();
        setSales(result.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      }
    } catch {
      setNotice("This browser could not save the sale. Keep this screen open and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <main className="offline-page"><section className="offline-card"><p>Loading this device’s saved store data…</p></section></main>;
  if (!snapshot) return <main className="offline-page"><section className="offline-card offline-empty"><span className="offline-status offline-status-warning"><FiWifiOff aria-hidden="true" /> No saved store data</span><h1>Open the store while online first</h1><p>{orphanedSalesCount ? `${orphanedSalesCount} saved sale${orphanedSalesCount === 1 ? " is" : "s are"} being kept on this device. Sign in with the account that recorded them to sync.` : "This device needs to load the product list and today’s drawer before it can take sales without a connection."}</p><Link href="/login" className="button button-primary">Return to sign in</Link></section></main>;

  return <main className="offline-page">
    <header className="offline-header"><Link className="offline-back" href="/"><FiArrowLeft aria-hidden="true" /> Store</Link><div><strong>{snapshot.store.name}</strong><small>Saved {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.savedAt))}</small></div><span className={`offline-status ${online ? "offline-status-online" : "offline-status-down"}`}>{online ? <FiWifi aria-hidden="true" /> : <FiWifiOff aria-hidden="true" />}{online ? "Online" : "Offline"}</span></header>
    <div className="offline-layout">
      <section className="offline-catalog"><div className="offline-heading"><div><span>QUICK CHECKOUT</span><h1>Choose items</h1><p>Saved product list · {snapshot.store.currency}</p></div><button type="button" className="offline-refresh" onClick={() => void refresh()} aria-label="Refresh saved data"><FiRefreshCw aria-hidden="true" /></button></div>
        {availableProducts.length ? <div className="offline-product-grid">{availableProducts.map((product) => <button key={product.id} type="button" className={`offline-product-card ${cart[product.id] ? "selected" : ""}`} onClick={() => add(product, 1)}><span>{product.name.slice(0, 1)}</span><strong>{product.name}</strong><small>{product.stock - (stockSold[product.id] ?? 0)} available</small><b>{formatMoney(product.priceCents, snapshot.store.currency)}</b>{cart[product.id] ? <i>{cart[product.id]}</i> : null}</button>)}</div> : <p className="offline-empty-note">No saved products are available to sell.</p>}
      </section>
      <section className="offline-basket"><div className="offline-heading"><div><span>THIS DEVICE</span><h2>Basket</h2></div><span className="offline-basket-count">{Object.values(cart).reduce((sum, count) => sum + count, 0)}</span></div>
        {!Object.keys(cart).length ? <p className="offline-empty-note">Tap an item to start a sale.</p> : <div className="offline-basket-lines">{products.filter((product) => cart[product.id]).map((product) => <div key={product.id} className="offline-basket-line"><div><strong>{product.name}</strong><small>{formatMoney(product.priceCents, snapshot.store.currency)} each</small></div><div className="offline-quantity"><button type="button" onClick={() => add(product, -1)} aria-label={`Remove one ${product.name}`}>−</button><b>{cart[product.id]}</b><button type="button" onClick={() => add(product, 1)} aria-label={`Add one ${product.name}`}>+</button></div><strong>{formatMoney(product.priceCents * cart[product.id], snapshot.store.currency)}</strong></div>)}</div>}
        <div className="offline-total"><span>Total</span><strong>{formatMoney(total, snapshot.store.currency)}</strong></div>
        <div className="offline-payments"><strong>Payment received</strong>{(["cash", "card", "bank"] as const).map((method) => <label key={method}><span>{method === "bank" ? "Bank / digital" : method[0].toUpperCase() + method.slice(1)}</span><div><small>{snapshot.store.currency}</small><input type="number" min="0" step={step} value={(payments[method] / factor).toFixed(digits)} onChange={(event) => setPayments((current) => ({ ...current, [method]: Math.round(Number(event.target.value || 0) * factor) }))} /></div></label>)}</div>
        {notice && <p className="offline-notice" role="status">{notice}</p>}
        <button type="button" className="button button-primary button-wide offline-complete" disabled={!Object.keys(cart).length || payments.cash + payments.card + payments.bank !== total || saving} onClick={() => void saveSale()}>{saving ? "Saving…" : online ? "Save sale" : "Save sale offline"}</button>
        <p className="offline-security-note">Sales are saved on this device first. Products and selling prices are checked again when syncing.</p>
      </section>
    </div>
    <section className="offline-queue"><div><div><span>SALES ON THIS DEVICE</span><h2>Sync status</h2></div><div className="offline-queue-actions"><span>{queuedCount} waiting{conflictCount ? ` · ${conflictCount} need review` : ""}</span>{online && queuedCount > 0 && <button type="button" className="offline-refresh" onClick={() => void sync()} aria-label="Sync saved sales"><FiRefreshCw aria-hidden="true" /></button>}</div></div>
      {!sales.length ? <p className="offline-empty-note">No saved offline sales yet.</p> : <div className="offline-sale-list">{sales.slice(0, 12).map((sale) => <article key={sale.id}><span className={`offline-sale-state state-${sale.state}`}>{sale.state === "synced" ? <FiCheck aria-hidden="true" /> : null}{sale.state === "queued" ? "Waiting to sync" : sale.state === "synced" ? "Synced" : "Needs review"}</span><strong>{formatMoney(sale.lines.reduce((sum, line) => sum + line.priceCents * line.quantity, 0), snapshot.store.currency)}</strong><small>{new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(new Date(sale.createdAt))}</small>{sale.error && <p>{sale.error}</p>}</article>)}</div>}
    </section>
    <p className="offline-footnote">Offline checkout requires an open drawer and a product list saved on this device. Keep this device secure.</p>
  </main>;
}
