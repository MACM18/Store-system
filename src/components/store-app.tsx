"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addExpense, adjustStock, closeCashDay, createDebtCustomer, createProduct, inviteStaffUser, openCashDay, receiveStock, recordCashMovement, recordDebtPayment, revokeAllDeviceSessions, revokeDeviceSession, sendStaffPasswordReset, updateProduct, updateStaffRole, updateStoreSettings } from "@/app/actions";
import { formatMoney, moneyInputStep } from "@/lib/money";
import { SearchableSelect } from "@/components/searchable-select";
import { Dialog } from "@/components/dialog";
import { ProfileMenu } from "@/components/profile-menu";
import { InstallAppButton } from "@/components/install-app-button";
import { businessDate } from "@/lib/dates";
import { OfflineSale, queueOfflineSale, readOfflineSales, saveOfflineSale, saveOfflineSnapshot, synchronizeOfflineSales } from "@/lib/offline-store";
import { FiActivity, FiArchive, FiBookOpen, FiCheck, FiClock, FiCreditCard, FiDollarSign, FiFileText, FiHome, FiInfo, FiLock, FiMinus, FiPackage, FiPieChart, FiPlus, FiRefreshCw, FiSearch, FiShoppingCart, FiSmartphone, FiUsers, FiWifi, FiWifiOff, FiX } from "react-icons/fi";

type Role = "OWNER" | "MANAGER" | "CASHIER";
type Product = { id: string; sku: string; name: string; category: string; priceCents: number; costCents: number | null; stock: number; lowStockAt: number; active: boolean };
type Props = {
  store: { id: string; name: string; currency: string; timezone: string };
  user: { id: string; name: string; email: string; role: Role };
  today: string; section: string; success?: string; error?: string; mailCode?: string; mailStatus?: string; mailMissing?: string;
  products: Product[];
  cashDay: { id: string; openingCash: number; countedCash: number | null; expectedCash: number | null; status: string; openedAt: string; closedAt: string | null } | null;
  metrics: { totalSales: number; totalExpenses: number; net: number; collectedToday: number; cashExpected: number; cashCounted: number | null; cashVariance: number | null; cashSales: number; cardSales: number; bankSales: number; debtSalesToday: number; debtCollectedToday: number; debtOutstanding: number; costOfGoods: number; grossProfit: number; lowStockCount: number; saleCount: number };
  week: Array<{ date: string; sales: number; expenses: number }>;
  expenses: Array<{ id: string; category: string; description: string; method: string; amountCents: number; createdAt: string }>;
  movements: Array<{ id: string; kind: string; reason: string; amountCents: number; createdAt: string }>;
  recentSales: Array<{ id: string; totalCents: number; createdAt: string; itemCount: number; methods: string[] }>;
  customers: Array<{ id: string; name: string; phone: string | null; balanceCents: number; sales: Array<{ id: string; totalCents: number; creditCents: number; paidCents: number; businessDate: string; createdAt: string; payments: Array<{ id: string; amountCents: number; method: string; businessDate: string }> }> }>;
  users: Array<{ id: string; name: string; email: string; role: Role; active: boolean; createdAt: string }>;
  deviceSessions: Array<{ id: string; userId: string; userName: string; role: Role; deviceName: string; createdAt: string; lastSeenAt: string; expiresAt: string }>;
};

const nav = [
  { id: "overview", label: "Overview", icon: FiHome },
  { id: "checkout", label: "Checkout", icon: FiShoppingCart },
  { id: "inventory", label: "Inventory", icon: FiPackage },
  { id: "cashflow", label: "Cashflow", icon: FiPieChart },
  { id: "debts", label: "Debt book", icon: FiBookOpen },
  { id: "settings", label: "Team & devices", icon: FiUsers, owner: true },
];
const paymentOptions = [{ value: "CASH", label: "Cash" }, { value: "CARD", label: "Card" }, { value: "BANK", label: "Bank / digital" }];
const roleOptions = [{ value: "OWNER", label: "Admin" }, { value: "MANAGER", label: "Manager" }, { value: "CASHIER", label: "Cashier" }];

function fmtTime(value: string) { return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function shortDate(value: string) { return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)); }
function humanize(value: string) { return value === "OWNER" ? "Admin" : value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function normalizeSearch(value: string) { return value.normalize("NFC").toLocaleLowerCase(); }
function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) { return <span className={`badge badge-${tone}`}>{children}</span>; }

function mailErrorMessage(error?: string, code?: string, status?: string, missing?: string) {
  if (error !== "invite-email" && error !== "reset-email") return undefined;
  const action = error === "invite-email" ? "Invitation" : "Password reset";
  const statusText = /^5\d\d$/.test(status ?? "") ? ` · SMTP ${status}` : "";
  const diagnostic = code ? ` (${code}${statusText})` : "";
  const allowedSettings = new Set(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "SMTP_FROM or MAIL_FROM"]);
  const missingList = (missing ?? "").split(",").filter((setting) => allowedSettings.has(setting));
  const guidance: Record<string, string> = {
    SMTP_CONFIG_MISSING: missingList.length
      ? `The running app cannot see: ${missingList.join(", ")}. Set those variables on the Dokploy application service, then redeploy or restart the running app. This message only identifies variable names; it does not show their values.`
      : "The running app cannot see one or more required SMTP settings. Check the app container’s environment and restart or redeploy it.",
    APP_URL_MISSING: "Set APP_URL to the public address of this app.",
    EAUTH: "The mail server rejected the login. Check the SMTP username and password or app password.",
    ETLS: "The secure connection could not be established. Check SMTP_SECURE and the port (465 for SSL, 587 for STARTTLS).",
    EENVELOPE: "The mail server rejected the sender or recipient. Check SMTP_FROM or MAIL_FROM and the destination address.",
    EDNS: "The mail server hostname could not be found. Check SMTP_HOST.",
    ECONNECTION: "The app could not connect to the mail server. Check SMTP_HOST, SMTP_PORT and outbound network access.",
    ECONNREFUSED: "The mail server refused the connection. Check SMTP_HOST and SMTP_PORT.",
    ECONNRESET: "The mail server closed the connection. Check the port and security mode.",
    ETIMEDOUT: "The mail server did not respond in time. Check network access and SMTP host/port.",
    ESOCKET: "The mail connection was interrupted. Check the SMTP host, port and security mode.",
    EHOSTUNREACH: "The mail server cannot be reached from the app host. Check outbound network access.",
  };
  return `${action} email could not be sent${diagnostic}. ${guidance[code ?? ""] ?? "Check the app server log for the matching ‘Account email delivery failed’ entry."}`;
}

function Notice({ success, error, mailCode, mailStatus, mailMissing }: { success?: string; error?: string; mailCode?: string; mailStatus?: string; mailMissing?: string }) {
  const messages: Record<string, string> = { product: "Add a valid name, SKU, buying price and selling price.", sku: "That SKU is already in use.", restock: "Stock could not be received. Check quantity and buying price, and make sure today’s drawer is open.", adjustment: "Stock was not changed. Check the quantity and reason.", checkout: "Sale could not be completed. Check payment totals and stock.", drawer: "Open today’s cash drawer before recording this expense or movement.", cart: "Your cart is empty or invalid.", expense: "Enter an expense category, description and amount.", opening: "Enter a valid opening cash amount.", count: "Enter the counted cash amount to close the day.", movement: "Open today’s drawer and enter a reason and amount.", "already-open": "Today’s drawer has already been opened.", user: "Enter a valid name, email and role.", email: "That email is already attached to a team member.", "invite-email": "The invitation email could not be sent. Check the outgoing mail settings and try again.", "reset-email": "The password reset email could not be sent. Check the outgoing mail settings and try again.", "reset-user": "Choose an active team member other than yourself.", role: "The role could not be changed. Refresh and try again.", "first-admin": "The original Admin account is protected and cannot be demoted.", "last-admin": "The last active Admin cannot be demoted.", "debt-payment": "The payment could not be added. Check the amount and remaining balance.", "debt-customer": "Enter the customer’s name.", "customer-exists": "That person is already in the debt book.", store: "Enter a store name and a valid time zone.", authorization: "Your role does not allow that action." };
  const successMessages: Record<string, string> = { product: "Product added to your inventory.", price: "Selling price updated.", restock: "New stock received and purchase recorded.", adjustment: "Stock count adjusted.", sale: "Sale completed and stock updated.", expense: "Expense added to today’s cashflow.", movement: "Cash movement recorded.", open: "Cash drawer opened for today.", closed: "Day closed. Your cash variance is ready to review.", invite: "Invitation sent. The link is valid for 72 hours.", "reset-sent": "Password reset link sent. It expires in 1 hour.", "role-updated": "Role updated. The team member has been signed out on all devices.", "debt-payment": "Debt payment recorded and balance updated.", "customer-added": "Customer added to the debt book.", store: "Store details updated." };
  if (!success && !error) return null;
  const mailMessage = mailErrorMessage(error, mailCode, mailStatus, mailMissing);
  return <div className={`notice ${error ? "notice-error" : "notice-success"}`} role="status">{error ? mailMessage ?? messages[error] ?? "Something needs attention. Please review the form." : successMessages[success!] ?? "Saved."}</div>;
}

export function StoreApp({ data }: { data: Props }) {
  const router = useRouter();
  const [section, setSection] = useState(data.section);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payments, setPayments] = useState({ cash: 0, card: 0, bank: 0 });
  const [onCredit, setOnCredit] = useState(false);
  const [creditCustomerName, setCreditCustomerName] = useState("");
  const [creditCustomerPhone, setCreditCustomerPhone] = useState("");
  const [inventorySearch, setInventorySearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [online, setOnline] = useState(true);
  const [queuedSales, setQueuedSales] = useState(0);
  const [retryableSales, setRetryableSales] = useState(0);
  const [offlineSold, setOfflineSold] = useState<Record<string, number>>({});
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const currency = data.store.currency;
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const factor = 10 ** digits;
  const step = moneyInputStep(currency);
  const cartLines = useMemo(() => data.products.filter((product) => cart[product.id]).map((product) => ({ product, quantity: cart[product.id] })), [cart, data.products]);
  const cartTotal = cartLines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
  const filteredProducts = data.products.filter((product) => {
    const query = normalizeSearch(inventorySearch.trim());
    const matchesQuery = !query || normalizeSearch(`${product.name} ${product.sku} ${product.category}`).includes(query);
    return matchesQuery && (!lowStockOnly || product.stock <= product.lowStockAt);
  });
  const totalUnits = data.products.reduce((sum, product) => sum + product.stock, 0);
  const retailStockValue = data.products.reduce((sum, product) => sum + product.stock * product.priceCents, 0);
  const buyingStockValue = data.products.reduce((sum, product) => sum + product.stock * (product.costCents ?? 0), 0);

  const refreshOfflineSales = useCallback(async () => {
    const sales = (await readOfflineSales().catch(() => [])).filter((sale) => sale.userId === data.user.id && sale.storeId === data.store.id);
    setQueuedSales(sales.filter((sale) => sale.state !== "synced").length);
    setRetryableSales(sales.filter((sale) => sale.state === "queued").length);
    const sold: Record<string, number> = {};
    for (const sale of sales.filter((item) => item.state !== "synced")) for (const line of sale.lines) sold[line.productId] = (sold[line.productId] ?? 0) + line.quantity;
    setOfflineSold(sold);
  }, [data.store.id, data.user.id]);

  const syncOfflineAndRefresh = useCallback(async () => {
    const before = await readOfflineSales().catch(() => []);
    const after = await synchronizeOfflineSales().catch(() => before);
    await refreshOfflineSales();
    if (before.some((sale) => sale.state === "queued" && after.some((next) => next.id === sale.id && next.state === "synced"))) router.refresh();
  }, [refreshOfflineSales, router]);

  useEffect(() => {
    const snapshot = {
      store: data.store,
      user: { id: data.user.id, name: data.user.name, role: data.user.role },
      today: data.today,
      products: data.products.map(({ id, name, sku, category, priceCents, stock, active }) => ({ id, name, sku, category, priceCents, stock, active })),
      cashDay: data.cashDay ? { status: data.cashDay.status, openingCash: data.cashDay.openingCash } : null,
      savedAt: new Date().toISOString(),
    };
    void Promise.resolve().then(() => setOnline(navigator.onLine));
    void saveOfflineSnapshot(snapshot)
      .then(() => Promise.resolve().then(refreshOfflineSales))
      .then(() => navigator.onLine ? Promise.resolve().then(syncOfflineAndRefresh) : undefined)
      .catch(() => undefined);
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void syncOfflineAndRefresh();
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("offline-sales-changed", refreshOfflineSales);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("offline-sales-changed", refreshOfflineSales);
    };
  }, [data, refreshOfflineSales, syncOfflineAndRefresh]);

  async function handleCheckoutSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkoutBusy || !cartLines.length) return;
    const createdAt = new Date().toISOString();
    const record: Omit<OfflineSale, "state"> = {
      id: crypto.randomUUID(),
      storeId: data.store.id,
      userId: data.user.id,
      createdAt,
      businessDate: businessDate(data.store.timezone, new Date(createdAt)),
      lines: cartLines.map(({ product, quantity }) => ({ productId: product.id, name: product.name, priceCents: product.priceCents, quantity })),
      payments: onCredit ? { cash: 0, card: 0, bank: 0 } : { cash: payments.cash, card: payments.card, bank: payments.bank },
      ...(onCredit ? { credit: { customerName: creditCustomerName.trim(), customerPhone: creditCustomerPhone.trim() } } : {}),
    };
    const savedLocally = async (state: "queued" | "conflict", message: string) => {
      await saveOfflineSale({ ...record, state, error: message });
      window.dispatchEvent(new Event("offline-sales-changed"));
      setCheckoutMessage(message);
      setCart({});
      setPayments({ cash: 0, card: 0, bank: 0 });
      setOnCredit(false);
      setCreditCustomerName("");
      setCreditCustomerPhone("");
      await refreshOfflineSales();
    };
    setCheckoutBusy(true);
    setCheckoutMessage("");
    try {
      await queueOfflineSale(record);
      await refreshOfflineSales();
    } catch {
      setCheckoutMessage("This device could not save the sale locally. Please keep this page open and try again.");
      setCheckoutBusy(false);
      return;
    }
    try {
      const response = await fetch("/api/offline/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record), cache: "no-store" });
      if (response.ok) {
        await saveOfflineSale({ ...record, state: "synced" });
        window.dispatchEvent(new Event("offline-sales-changed"));
        await refreshOfflineSales();
        setCheckoutMessage("Sale completed.");
        setCart({});
        setPayments({ cash: 0, card: 0, bank: 0 });
        setOnCredit(false);
        setCreditCustomerName("");
        setCreditCustomerPhone("");
        router.refresh();
      } else {
        const result = await response.json().catch(() => ({})) as { error?: string };
        const message = result.error ?? "The sale could not be confirmed. It was saved on this device for review.";
        if (response.status === 401 || response.status >= 500) await savedLocally("queued", `${message} It will retry when connected and signed in.`);
        else await savedLocally("conflict", `${message} This sale is saved on this device and needs review.`);
      }
    } catch {
      await savedLocally("queued", "Connection lost. Sale saved on this device and will sync when you’re back online.");
      setOnline(false);
    } finally {
      setCheckoutBusy(false);
    }
  }

  function updateCart(productId: string, quantity: number) {
    const product = data.products.find((item) => item.id === productId);
    if (!product) return;
    const next = Math.max(0, Math.min(product.stock - (offlineSold[product.id] ?? 0), quantity));
    const newCart = { ...cart };
    if (!next) delete newCart[productId]; else newCart[productId] = next;
    setCart(newCart);
    const total = data.products.reduce((sum, item) => sum + item.priceCents * (newCart[item.id] ?? 0), 0);
    setPayments({ cash: total, card: 0, bank: 0 });
  }

  const canManage = data.user.role === "OWNER" || data.user.role === "MANAGER";
  const dateLabel = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", timeZone: data.store.timezone }).format(new Date());
  const maxBar = Math.max(...data.week.map((item) => item.sales), 1);

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="store-switcher"><span className="store-home-icon"><FiHome aria-hidden="true" /></span><span className="store-name-wrap"><strong>{data.store.name}</strong><small>Store workspace</small></span><span className={`store-live-indicator ${data.cashDay?.status === "OPEN" ? "is-live" : ""}`} title={data.cashDay?.status === "OPEN" ? "Drawer open" : "Drawer closed"} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">
        {nav.filter((item) => !item.owner || data.user.role === "OWNER").map((item) => <button key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}><span className="nav-icon"><item.icon aria-hidden="true" /></span><span>{item.label}</span>{item.id === "inventory" && data.metrics.lowStockCount > 0 && <span className="nav-count">{data.metrics.lowStockCount}</span>}</button>)}
      </nav>
      <div className="sidebar-spacer" />
      <div className="drawer-status"><span className={`status-dot ${data.cashDay?.status === "OPEN" ? "status-open" : ""}`} /><div><strong>{data.cashDay?.status === "OPEN" ? "Drawer is open" : "Drawer is closed"}</strong><small>{data.cashDay?.status === "OPEN" ? "Ready for today’s sales" : "Start a shift to begin"}</small></div></div>
      <ProfileMenu user={data.user} placement="sidebar" onTeamClick={() => setSection("settings")} />
    </aside>

    <main className="main-area">
      <header className="topbar"><button className="mobile-brand" onClick={() => setSection("overview")}>{data.store.name}</button><div className="breadcrumb"><span>{data.store.name}</span><span className="crumb-sep">/</span><strong>{nav.find((item) => item.id === section)?.label ?? "Overview"}</strong></div><div className="topbar-right"><span className="today-label">{dateLabel}</span><InstallAppButton /><Link href="/offline" prefetch className="offline-counter-link"><FiSmartphone aria-hidden="true" /><span>Offline counter</span></Link><ProfileMenu user={data.user} placement="topbar" onTeamClick={() => setSection("settings")} /></div></header>
      <div className="content-wrap"><Notice success={data.success} error={data.error} mailCode={data.mailCode} mailStatus={data.mailStatus} mailMissing={data.mailMissing} />{(!online || queuedSales > 0) && <aside className={`offline-app-banner ${online ? "is-connected" : "is-disconnected"}`}><span className="offline-banner-icon">{online ? <FiWifi aria-hidden="true" /> : <FiWifiOff aria-hidden="true" />}</span><div><strong>{online ? `${queuedSales} saved sale${queuedSales === 1 ? "" : "s"} need attention` : "You’re offline"}</strong><small>{online ? "Review and sync sales saved on this device." : "Checkout is saved on this device and syncs when the connection returns."}</small></div><Link href="/offline" prefetch className="offline-app-link">Open offline counter <FiSmartphone aria-hidden="true" /></Link>{online && retryableSales > 0 && <button type="button" className="offline-sync-button" onClick={() => void syncOfflineAndRefresh()}><FiRefreshCw aria-hidden="true" /> Sync</button>}</aside>}

        {section === "overview" && <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> TODAY AT A GLANCE</div><h1>Good day, {data.user.name.split(" ")[0]}<span className="heading-period">.</span></h1><p>Today&apos;s sales, cash and store activity.</p></div></section>
          <section className="home-action-layout" aria-label="Quick actions">
            <button className="home-primary-action" onClick={() => setSection("checkout")}><span className="home-primary-action-icon"><FiShoppingCart aria-hidden="true" /></span><span><strong>New sale</strong><small>Start a checkout</small></span><FiPlus className="home-primary-action-end" aria-hidden="true" /></button>
            <div className="home-shortcuts">
              <button className="home-shortcut" onClick={() => setSection("cashflow")}><span className="home-shortcut-icon">{data.cashDay ? <FiPieChart aria-hidden="true" /> : <FiClock aria-hidden="true" />}</span><strong>{data.cashDay ? "Cashflow" : "Open drawer"}</strong><small>{data.cashDay ? "Review today’s money" : "Enter starting cash"}</small></button>
              <button className="home-shortcut" onClick={() => setSection("inventory")}><span className="home-shortcut-icon"><FiPackage aria-hidden="true" /></span><strong>{canManage ? "Manage stock" : "Browse products"}</strong><small>{canManage && data.metrics.lowStockCount > 0 ? `${data.metrics.lowStockCount} low on stock` : "Prices and availability"}</small></button>
              <button className="home-shortcut" onClick={() => setSection("debts")}><span className="home-shortcut-icon"><FiBookOpen aria-hidden="true" /></span><strong>Debt book</strong><small>{formatMoney(data.metrics.debtOutstanding, currency)} outstanding</small></button>
            </div>
          </section>
          <section className="home-cash-section" aria-labelledby="home-cash-heading">
            <div className="home-section-heading"><div><span className="section-kicker">CASH POSITION</span><h2 id="home-cash-heading">Today&apos;s cash</h2></div><button className="text-button" onClick={() => setSection("cashflow")}>Cashflow details</button></div>
            <div className="metric-grid">
            <article className="metric-card metric-primary"><div className="metric-head"><span>Sales today</span><span className="metric-icon"><FiShoppingCart aria-hidden="true" /></span></div><strong className="metric-value">{formatMoney(data.metrics.totalSales, currency)}</strong><div className="metric-foot"><span className="metric-accent">{data.metrics.saleCount} sales</span><span>·</span><span>{data.metrics.cashSales > 0 ? `${formatMoney(data.metrics.cashSales, currency)} received` : "No cash received yet"}</span></div><div className="metric-spark"><span style={{ height: "28%" }} /><span style={{ height: "43%" }} /><span style={{ height: "36%" }} /><span style={{ height: "57%" }} /><span style={{ height: "49%" }} /><span style={{ height: "73%" }} /><span style={{ height: "62%" }} /><span style={{ height: "100%" }} /></div></article>
            <article className="metric-card"><div className="metric-head"><span>Money out</span><span className="metric-icon metric-icon-warm"><FiFileText aria-hidden="true" /></span></div><strong className="metric-value">{formatMoney(data.metrics.totalExpenses, currency)}</strong><div className="metric-foot"><span>Including {formatMoney(data.metrics.costOfGoods, currency)} product cost sold</span></div><div className="metric-indicator"><span className="indicator-line out-line" /></div></article>
            <article className="metric-card"><div className="metric-head"><span>Net movement</span><span className="metric-icon metric-icon-clay"><FiRefreshCw aria-hidden="true" /></span></div><strong className={`metric-value ${data.metrics.net < 0 ? "negative" : ""}`}>{formatMoney(data.metrics.net, currency)}</strong><div className="metric-foot"><span>Payments received + cash in − expenses − cash out</span></div><div className="metric-indicator"><span className="indicator-line net-line" /></div></article>
            <article className="metric-card"><div className="metric-head"><span>Cash in drawer</span><span className="metric-icon metric-icon-cream"><FiArchive aria-hidden="true" /></span></div><strong className="metric-value">{data.cashDay ? formatMoney(data.metrics.cashExpected, currency) : "—"}</strong><div className="metric-foot">{data.cashDay?.status === "CLOSED" ? <><span className="metric-accent">Counted {formatMoney(data.metrics.cashCounted ?? 0, currency)}</span><span>·</span><span className={data.metrics.cashVariance === 0 ? "positive" : "negative"}>{data.metrics.cashVariance === 0 ? "Balanced" : `${formatMoney(data.metrics.cashVariance ?? 0, currency)} variance`}</span></> : <span>{data.cashDay ? "Expected balance · day still open" : "Open the drawer to start"}</span>}</div><div className="metric-indicator"><span className="indicator-line cash-line" /></div></article>
            </div>
          </section>
          <section className="panel tender-panel home-payment-panel"><div className="panel-heading"><div><div className="section-kicker">PAYMENT MIX</div><h2>Where today&apos;s money came from</h2></div></div><div className="tender-grid home-tender-grid"><div className="tender-tile"><span className="tender-icon cash-tender"><FiDollarSign aria-hidden="true" /></span><div><small>Cash</small><strong>{formatMoney(data.metrics.cashSales, currency)}</strong></div><span className="tender-share">{data.metrics.collectedToday ? Math.round(data.metrics.cashSales / data.metrics.collectedToday * 100) : 0}%</span></div><div className="tender-tile"><span className="tender-icon card-tender"><FiCreditCard aria-hidden="true" /></span><div><small>Card</small><strong>{formatMoney(data.metrics.cardSales, currency)}</strong></div><span className="tender-share">{data.metrics.collectedToday ? Math.round(data.metrics.cardSales / data.metrics.collectedToday * 100) : 0}%</span></div><div className="tender-tile"><span className="tender-icon bank-tender"><FiSmartphone aria-hidden="true" /></span><div><small>Bank / digital</small><strong>{formatMoney(data.metrics.bankSales, currency)}</strong></div><span className="tender-share">{data.metrics.collectedToday ? Math.round(data.metrics.bankSales / data.metrics.collectedToday * 100) : 0}%</span></div></div></section>
          <section className="overview-grid">
            <article className="panel chart-panel"><div className="panel-heading"><div><div className="section-kicker">THE LAST SEVEN DAYS</div><h2>Sales rhythm</h2></div><Badge tone="brand">This week</Badge></div><div className="chart-legend"><span><i className="legend-dot sales-dot" />Sales</span><span><i className="legend-dot expense-dot" />Expenses</span></div><div className="bar-chart">{data.week.map((item) => <div className="bar-group" key={item.date}><div className="bar-area"><div className="bar-pair"><span className="bar sales-bar" style={{ height: `${Math.max(3, item.sales / maxBar * 100)}%` }} title={`Sales ${formatMoney(item.sales, currency)}`} /><span className="bar expense-bar" style={{ height: `${Math.max(item.expenses ? 3 : 0, item.expenses / maxBar * 100)}%` }} title={`Expenses ${formatMoney(item.expenses, currency)}`} /></div></div><small>{shortDate(item.date).split(",")[0]}</small></div>)}</div><div className="chart-total"><span>Product margin today</span><strong>{formatMoney(data.metrics.grossProfit, currency)}</strong><small>Sales less FIFO buying cost</small></div></article>
            <article className="panel activity-panel"><div className="panel-heading"><div><div className="section-kicker">RECENT ACTIVITY</div><h2>Today&apos;s movement</h2></div><button className="text-button" onClick={() => setSection("cashflow")}>See all </button></div>{data.recentSales.length === 0 && data.expenses.length === 0 && data.movements.length === 0 ? <div className="empty-state compact-empty"><span className="empty-icon"><FiActivity aria-hidden="true" /></span><strong>A fresh start</strong><span>Your sales and cash movements will show here.</span></div> : <div className="activity-list">{[...data.recentSales.map((item) => ({ id: item.id, title: `Sale · ${item.itemCount} item${item.itemCount === 1 ? "" : "s"}`, detail: item.methods.map(humanize).join(" + "), amount: item.totalCents, time: item.createdAt, kind: "sale" })), ...data.expenses.map((item) => ({ id: item.id, title: item.description, detail: item.category, amount: -item.amountCents, time: item.createdAt, kind: "expense" })), ...data.movements.map((item) => ({ id: item.id, title: item.reason, detail: humanize(item.kind), amount: item.kind === "CASH_IN" ? item.amountCents : -item.amountCents, time: item.createdAt, kind: "movement" }))].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 6).map((item) => <div className="activity-item" key={item.id}><span className={`activity-glyph ${item.kind}`}>{item.kind === "sale" ? <FiShoppingCart aria-hidden="true" /> : item.amount > 0 ? <FiPlus aria-hidden="true" /> : <FiMinus aria-hidden="true" />}</span><div className="activity-copy"><strong>{item.title}</strong><small>{item.detail} · {fmtTime(item.time)}</small></div><b className={item.amount < 0 ? "negative" : ""}>{item.amount < 0 ? "−" : "+"}{formatMoney(Math.abs(item.amount), currency)}</b></div>)}</div>}</article>
          </section>
          <section className="panel home-products-panel"><div className="panel-heading"><div><div className="section-kicker">READY TO SELL</div><h2>Products and prices</h2></div><button className="text-button" onClick={() => setSection("checkout")}>Go to checkout</button></div>
            {data.products.filter((product) => product.stock > 0).length === 0 ? <div className="home-products-empty"><span>No items ready to sell yet.</span><button className="text-button" onClick={() => setSection("inventory")}>Add products</button></div> : <div className="home-product-grid">{data.products.filter((product) => product.stock > 0).slice(0, 4).map((product) => <button className="home-product-card" key={product.id} onClick={() => { if (data.cashDay?.status === "OPEN") { updateCart(product.id, (cart[product.id] ?? 0) + 1); setSection("checkout"); } else { setSection("cashflow"); } }}><span className="home-product-category">{product.category}</span><strong className="home-product-name">{product.name}</strong><span className="home-product-stock">{product.stock - (offlineSold[product.id] ?? 0)} in stock</span><b className="home-product-price">{formatMoney(product.priceCents, currency)}</b><span className="home-product-action">{data.cashDay?.status === "OPEN" ? <><FiPlus aria-hidden="true" /> Add to sale</> : "Open drawer to sell"}</span></button>)}</div>}
          </section>
        </>}

        {section === "checkout" && <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> COUNTER</div><h1>Make a sale<span className="heading-period">.</span></h1><p>Pick products, record payment, or add the sale to a customer account.</p></div><div className={`shift-pill ${data.cashDay?.status === "OPEN" ? "shift-pill-open" : ""}`}><span />{data.cashDay?.status === "OPEN" ? "Drawer open" : "Drawer closed"}</div></section>
          {!data.cashDay || data.cashDay.status !== "OPEN" ? <div className="shift-callout"><div className="shift-icon"><FiClock aria-hidden="true" /></div><div className="shift-copy"><strong>Open the cash drawer before starting a sale</strong><span>Set today&apos;s opening cash under Cashflow.</span></div><button className="button button-primary" onClick={() => setSection("cashflow")}>Open cash drawer </button></div> : <div className="checkout-layout"><section className="panel product-picker"><div className="panel-heading"><div><div className="section-kicker">PRODUCTS</div><h2>Choose items</h2></div><span className="muted-count">{data.products.filter((item) => item.stock - (offlineSold[item.id] ?? 0) > 0).length} available</span></div>{data.products.filter((item) => item.stock - (offlineSold[item.id] ?? 0) > 0).length === 0 ? <div className="empty-state"><span className="empty-icon"><FiPackage aria-hidden="true" /></span><strong>No stock available</strong><span>Add products or receive stock in Inventory.</span></div> : <div className="product-grid">{data.products.filter((item) => item.stock - (offlineSold[item.id] ?? 0) > 0).map((product) => <button type="button" className={`product-tile ${cart[product.id] ? "product-selected" : ""}`} key={product.id} onClick={() => updateCart(product.id, (cart[product.id] ?? 0) + 1)}><span className="product-tile-art">{product.name.slice(0, 1).toUpperCase()}</span><strong>{product.name}</strong><small>{product.sku} · {product.stock - (offlineSold[product.id] ?? 0)} in stock</small><b>{formatMoney(product.priceCents, currency)}</b>{cart[product.id] && <span className="product-quantity">{cart[product.id]}</span>}</button>)}</div>}</section>
            <section className="panel cart-panel"><div className="panel-heading"><div><div className="section-kicker">CURRENT SALE</div><h2>Your basket</h2></div><span className="cart-count">{cartLines.reduce((sum, line) => sum + line.quantity, 0)}</span></div>{cartLines.length === 0 ? <div className="empty-state cart-empty"><span className="empty-icon"><FiShoppingCart aria-hidden="true" /></span><strong>Nothing here yet</strong><span>Choose products to get started.</span></div> : <><div className="cart-lines">{cartLines.map(({ product, quantity }) => <div className="cart-line" key={product.id}><span className="cart-product-mark">{product.name.slice(0, 1)}</span><div className="cart-product-info"><strong>{product.name}</strong><small>{formatMoney(product.priceCents, currency)} each</small></div><div className="quantity-control"><button type="button" onClick={() => updateCart(product.id, quantity - 1)} aria-label={`Remove one ${product.name}`}><FiMinus aria-hidden="true" /></button><b>{quantity}</b><button type="button" onClick={() => updateCart(product.id, quantity + 1)} aria-label={`Add one ${product.name}`}><FiPlus aria-hidden="true" /></button></div><strong className="cart-line-total">{formatMoney(product.priceCents * quantity, currency)}</strong></div>)}</div><div className="sale-mode-toggle"><button type="button" className={!onCredit ? "active" : ""} onClick={() => setOnCredit(false)}>Pay now</button><button type="button" className={onCredit ? "active" : ""} onClick={() => setOnCredit(true)}>On account</button></div>{onCredit ? <div className="credit-customer-fields"><p>The full sale amount will be added to this person’s debt book.</p><label>Customer name<input value={creditCustomerName} onChange={(event) => setCreditCustomerName(event.target.value)} maxLength={100} required placeholder="Who is buying?" /></label><label>Phone number <span className="optional-label">Optional</span><input value={creditCustomerPhone} onChange={(event) => setCreditCustomerPhone(event.target.value)} maxLength={32} inputMode="tel" placeholder="For their account record" /></label></div> : <div className="payment-fields"><div className="section-kicker">PAYMENT BREAKDOWN</div>{(["cash", "card", "bank"] as const).map((key) => <label className="payment-input-row" key={key}><span>{key === "bank" ? "Bank / digital" : humanize(key)}</span><div><span className="currency-hint">{currency}</span><input type="number" min="0" step={step} value={(payments[key] / factor).toFixed(digits)} onChange={(event) => setPayments((current) => ({ ...current, [key]: Math.round(Number(event.target.value || 0) * factor) }))} /></div></label>)}</div>}<div className="cart-total-row"><span>{onCredit ? "Added to debt" : "Total due"}</span><strong>{formatMoney(cartTotal, currency)}</strong></div>{onCredit ? <div className="payment-match match-ok">Outstanding balance will be tracked for this customer.</div> : <div className={`payment-match ${payments.cash + payments.card + payments.bank === cartTotal ? "match-ok" : "match-error"}`}>{payments.cash + payments.card + payments.bank === cartTotal ? <><FiCheck aria-hidden="true" /> Payment total matches</> : `Payment difference · ${formatMoney(Math.abs(cartTotal - payments.cash - payments.card - payments.bank), currency)}`}</div>}{checkoutMessage && <p className="offline-notice checkout-status-notice" role="status">{checkoutMessage}</p>}<form onSubmit={handleCheckoutSubmit}><input type="hidden" name="cart" value={JSON.stringify(cartLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })))} /><input type="hidden" name="cash" value={(payments.cash / factor).toFixed(digits)} /><input type="hidden" name="card" value={(payments.card / factor).toFixed(digits)} /><input type="hidden" name="bank" value={(payments.bank / factor).toFixed(digits)} /><button className="button button-primary button-wide" disabled={!cartLines.length || (onCredit ? !creditCustomerName.trim() : payments.cash + payments.card + payments.bank !== cartTotal) || checkoutBusy}>{checkoutBusy ? "Saving sale…" : onCredit ? online ? "Record debt sale" : "Save debt sale offline" : online ? "Complete sale" : "Save sale offline"}</button></form></>}</section></div>}
        </>}

        {section === "inventory" && <>
          <section className="page-heading inventory-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> PRODUCTS & STOCK</div><h1>Inventory<span className="heading-period">.</span></h1><p>See stock, buying cost, selling price and estimated margin together.</p></div></section>
          <section className="inventory-metrics" aria-label="Inventory summary">
            <article><span>Products</span><strong>{data.products.length}</strong></article>
            <article><span>Units on hand</span><strong>{totalUnits.toLocaleString()}</strong></article>
            <article><span>Low stock</span><strong className={data.metrics.lowStockCount ? "inventory-warning" : ""}>{data.metrics.lowStockCount}</strong></article>
            <article><span>Retail value</span><strong>{formatMoney(retailStockValue, currency)}</strong></article>
            <article><span>Buying value</span><strong>{formatMoney(buyingStockValue, currency)}</strong></article>
          </section>

          {canManage && <section className="inventory-tools inventory-tools-wide">
            <Dialog title="Add a product" description="Product names and categories support Sinhala and other Unicode text." trigger={<button className="inventory-action-card"><span className="inventory-action-icon"><FiPlus aria-hidden="true" /></span><span><strong>Add a product</strong><small>Set buying and selling prices</small></span><FiPlus className="inventory-action-end" aria-hidden="true" /></button>}>
              <form action={createProduct} className="inline-form form-wrap modal-form"><label>Product name<input name="name" required maxLength={120} placeholder="Type a product name · e.g. කිරිපිටි" /></label><label>SKU / code<input name="sku" required maxLength={60} placeholder="SKU-001" /></label><label>Category<input name="category" maxLength={60} placeholder="e.g. බීම වර්ග" /></label><label>Selling price ({currency})<input name="price" type="number" min="0.01" step={step} required placeholder="0.00" /></label><label>Opening quantity<input name="stock" type="number" min="0" step="1" required defaultValue="0" /></label><label>Buying price per unit ({currency})<input name="cost" type="number" min="0" step={step} required placeholder="0.00" /></label><label>Low stock alert at<input name="lowStockAt" type="number" min="0" step="1" defaultValue="5" /></label><button className="button button-dark">Add product <FiPlus aria-hidden="true" /></button></form>
            </Dialog>
            <Dialog title="Receive new stock" description="Record the quantity and buying price for this delivery." trigger={<button className="inventory-action-card"><span className="inventory-action-icon"><FiPackage aria-hidden="true" /></span><span><strong>Receive stock</strong><small>Add a delivery with its own cost</small></span><FiPlus className="inventory-action-end" aria-hidden="true" /></button>}>
              <form action={receiveStock} className="inline-form form-wrap modal-form"><label>Product<SearchableSelect name="productId" required placeholder="Find a product" searchPlaceholder="Type a product name or SKU" options={data.products.map((product) => ({ value: product.id, label: `${product.name} · ${product.sku} · ${product.stock} on hand` }))} /></label><label>Quantity received<input name="quantity" type="number" min="1" step="1" required placeholder="24" /></label><label>Buying price per unit ({currency})<input name="unitCost" type="number" min="0" step={step} required placeholder="0.00" /></label><label>Paid by<SearchableSelect name="method" defaultValue="CASH" required options={paymentOptions} /></label><label className="wide-field">Note<input name="note" placeholder="Supplier or delivery note" /></label><button className="button button-dark">Receive stock</button></form>
            </Dialog>
            <Dialog title="Adjust a stock count" description="Use this for count corrections, damaged goods, samples or other changes." trigger={<button className="inventory-action-card"><span className="inventory-action-icon"><FiRefreshCw aria-hidden="true" /></span><span><strong>Adjust stock</strong><small>Correct quantities with a reason</small></span><FiPlus className="inventory-action-end" aria-hidden="true" /></button>}>
              <form action={adjustStock} className="inline-form form-wrap modal-form"><label>Product<SearchableSelect name="productId" required placeholder="Find a product" searchPlaceholder="Type a product name or SKU" options={data.products.map((product) => ({ value: product.id, label: `${product.name} · ${product.sku} · ${product.stock} on hand` }))} /></label><label>Quantity change<input name="delta" type="number" required step="1" placeholder="Use a minus for stock removed" /></label><label className="wide-field">Reason<input name="reason" required minLength={3} placeholder="Count correction, damaged stock, samples…" /></label><button className="button button-dark">Save adjustment</button></form>
            </Dialog>
          </section>}

          <section className="inventory-list-section">
            <div className="inventory-list-header"><div><div className="section-kicker">PRODUCT CATALOGUE</div><h2>All products <span>{filteredProducts.length}</span></h2></div><div className="inventory-filters"><label className="inventory-search"><FiSearch aria-hidden="true" /><input type="search" value={inventorySearch} onChange={(event) => setInventorySearch(event.target.value)} placeholder="Search name, SKU or category" aria-label="Search products" /></label><button type="button" className={`inventory-filter-button ${lowStockOnly ? "active" : ""}`} onClick={() => setLowStockOnly((value) => !value)}>{lowStockOnly ? "Showing low stock" : "Low stock only"}</button></div></div>
            {data.products.length === 0 ? <div className="empty-state inventory-empty"><span className="empty-icon"><FiPackage aria-hidden="true" /></span><strong>Your inventory starts here</strong><span>Add your first item to track stock, buying price and selling price.</span></div> : filteredProducts.length === 0 ? <div className="empty-state inventory-empty"><strong>No matching products</strong><span>Try a different name, SKU, category or stock filter.</span><button className="text-button" onClick={() => { setInventorySearch(""); setLowStockOnly(false); }}>Clear filters</button></div> : <div className="product-catalog-grid">{filteredProducts.map((product) => {
              const low = product.stock <= product.lowStockAt;
              const margin = product.costCents === null ? null : product.priceCents - product.costCents;
              const marginRate = margin === null || product.priceCents <= 0 ? null : Math.round(margin / product.priceCents * 100);
              const stockWidth = product.lowStockAt > 0 ? Math.min(100, Math.round(product.stock / product.lowStockAt * 100)) : product.stock > 0 ? 100 : 0;
              return <article className="product-catalog-card" key={product.id}>
                <div className="product-card-top"><span className="product-card-mark">{product.name.slice(0, 1)}</span><div className="product-card-identity"><h3>{product.name}</h3><span>{product.category || "General"} <i>·</i> {product.sku}</span></div><Badge tone={low ? "orange" : "brand"}>{low ? "Low stock" : "In stock"}</Badge></div>
                <div className="catalog-price-main"><small>SELLING PRICE</small><strong>{formatMoney(product.priceCents, currency)}</strong></div>
                <div className="catalog-price-details"><div><small>Buying price</small><strong>{product.costCents === null ? "Not set" : formatMoney(product.costCents, currency)}</strong></div><div><small>Est. margin / unit</small><strong className={margin === null ? "muted" : margin < 0 ? "negative" : "positive"}>{margin === null ? "Not set" : formatMoney(margin, currency)}{marginRate === null ? "" : ` · ${marginRate}%`}</strong></div></div>
                <div className="product-stock-info"><div><span>Available stock</span><strong>{product.stock.toLocaleString()} <small>units</small></strong></div><div className={`stock-meter ${low ? "low" : ""}`}><span style={{ width: `${stockWidth}%` }} /></div><small>{low ? `Restock point · ${product.lowStockAt} units` : `Alert at ${product.lowStockAt} units`}</small></div>
                {canManage && <Dialog title={`Edit ${product.name}`} description="Update this product name, buying price and current selling price." className="product-edit-dialog" trigger={<button type="button" className="product-edit-trigger">Edit product</button>}><form action={updateProduct} className="product-edit-form modal-form"><input type="hidden" name="id" value={product.id} /><input type="hidden" name="lowStockAt" value={product.lowStockAt} /><label>Product name<input name="name" defaultValue={product.name} required maxLength={120} /></label><div className="product-edit-price-fields"><label>Selling price ({currency})<input name="price" defaultValue={(product.priceCents / factor).toFixed(digits)} type="number" min="0.01" step={step} required /></label><label>Buying price ({currency})<input name="cost" defaultValue={((product.costCents ?? 0) / factor).toFixed(digits)} type="number" min="0" step={step} required /></label></div><button className="button button-outline">Save changes</button></form></Dialog>}
              </article>;
            })}</div>}
          </section>
          <div className="inventory-footnote"><span><FiInfo aria-hidden="true" /></span> Each delivery keeps its own buying price; the estimated margin uses the current buying price. Sales use the cost of the oldest stock first.</div>
        </>}

        {section === "cashflow" && <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> DAILY CASHBOOK</div><h1>Cashflow<span className="heading-period">.</span></h1><p>Every inflow and outflow, in one place.</p></div><Badge tone={data.cashDay?.status === "OPEN" ? "brand" : "neutral"}>{data.cashDay?.status === "OPEN" ? "Drawer open" : "Drawer closed"}</Badge></section>
          <section className="cashflow-summary-grid"><div className="cashflow-highlight"><div className="section-kicker">EXPECTED DRAWER CASH</div><strong>{data.cashDay ? formatMoney(data.metrics.cashExpected, currency) : "—"}</strong><span>{data.cashDay ? `Opening ${formatMoney(data.cashDay.openingCash, currency)} + cash sales − cash paid out` : "Open the cash drawer to begin today’s record."}</span></div><div className="cashflow-mini"><span>Total sales</span><strong>{formatMoney(data.metrics.totalSales, currency)}</strong><small>Across all payment methods</small></div><div className="cashflow-mini"><span>Cash expenses</span><strong>{formatMoney(data.expenses.filter((item) => item.method === "CASH").reduce((sum, item) => sum + item.amountCents, 0), currency)}</strong><small>Reduces the cash in drawer</small></div><div className="cashflow-mini"><span>Cash variance</span><strong className={data.metrics.cashVariance === null ? "" : data.metrics.cashVariance === 0 ? "positive" : "negative"}>{data.metrics.cashVariance === null ? "—" : formatMoney(data.metrics.cashVariance, currency)}</strong><small>{data.cashDay?.status === "CLOSED" ? "Counted less expected" : "Available after closing"}</small></div></section>
          {!data.cashDay ? <section className="panel action-panel open-drawer-panel"><div className="cash-action-icon"><FiClock aria-hidden="true" /></div><div className="action-panel-copy"><div className="section-kicker">OPENING COUNT</div><h2>Set your opening cash</h2><p>Count the cash float in your drawer before you start trading.</p></div><form action={openCashDay} className="action-inline-form opening-drawer-form"><label>Opening amount <span>{currency}</span><input name="openingCash" type="number" min="0" step={step} required placeholder="0.00" /></label><button className="button button-primary">Open drawer</button></form></section> : <section className="panel action-panel"><div className={`cash-action-icon ${data.cashDay.status === "CLOSED" ? "closed-icon" : ""}`}>{data.cashDay.status === "CLOSED" ? <FiCheck aria-hidden="true" /> : <FiClock aria-hidden="true" />}</div><div className="action-panel-copy"><div className="section-kicker">{data.cashDay.status === "OPEN" ? "END OF DAY" : "DAY CLOSED"}</div><h2>{data.cashDay.status === "OPEN" ? "Reconcile the drawer" : "Today’s count is in"}</h2><p>{data.cashDay.status === "OPEN" ? `Opening cash ${formatMoney(data.cashDay.openingCash, currency)} · expected now ${formatMoney(data.metrics.cashExpected, currency)}` : `Expected ${formatMoney(data.cashDay.expectedCash ?? 0, currency)} · counted ${formatMoney(data.cashDay.countedCash ?? 0, currency)}`}</p></div>{data.cashDay.status === "OPEN" ? <form action={closeCashDay} className="action-inline-form"><label>Counted cash <span>{currency}</span><input name="countedCash" type="number" min="0" step={step} required placeholder="0.00" /></label><button className="button button-dark">Close day </button></form> : <div className="variance-chip"><small>Cash difference</small><strong className={(data.metrics.cashVariance ?? 0) === 0 ? "positive" : "negative"}>{formatMoney(data.metrics.cashVariance ?? 0, currency)}</strong></div>}</section>}
          <div className="cashflow-columns"><section className="panel"><div className="panel-heading"><div><div className="section-kicker">CASH MOVEMENTS</div><h2>In and out</h2></div></div><form action={recordCashMovement} className="cash-entry-form"><label>Movement<SearchableSelect name="kind" defaultValue="CASH_IN" required options={[{ value: "CASH_IN", label: "Cash in" }, { value: "CASH_OUT", label: "Cash out" }]} /></label><label>Amount ({currency})<input name="amount" type="number" min="0.01" step={step} required /></label><label className="wide-field">Reason<input name="reason" required minLength={3} placeholder="Petty cash top-up, bank deposit…" /></label><button className="button button-outline">Record movement <FiPlus aria-hidden="true" /></button></form>{data.movements.length === 0 ? <p className="list-empty">No separate cash movements recorded today.</p> : data.movements.map((item) => <div className="simple-list-row" key={item.id}><span className={`movement-bullet ${item.kind === "CASH_IN" ? "in" : "out"}`}>{item.kind === "CASH_IN" ? "+" : "−"}</span><div><strong>{item.reason}</strong><small>{humanize(item.kind)} · {fmtTime(item.createdAt)}</small></div><b className={item.kind === "CASH_OUT" ? "negative" : "positive"}>{item.kind === "CASH_OUT" ? "−" : "+"}{formatMoney(item.amountCents, currency)}</b></div>)}</section>
            <section className="panel"><div className="panel-heading"><div><div className="section-kicker">EXPENSES</div><h2>Record an expense</h2></div></div>{canManage ? <form action={addExpense} className="expense-form"><label>Category<input name="category" required placeholder="Rent, utilities, supplies…" /></label><label>Description<input name="description" required placeholder="What was it for?" /></label><div className="form-grid"><label>Amount ({currency})<input name="amount" type="number" min="0.01" step={step} required /></label><label>Paid by<SearchableSelect name="method" defaultValue="CASH" required options={paymentOptions} /></label></div><button className="button button-outline">Add expense </button></form> : <div className="permission-note">Managers can record expenses. You can see today’s totals and movement here.</div>}{data.expenses.length > 0 && <div className="expense-list">{data.expenses.slice(0, 6).map((expense) => <div className="simple-list-row" key={expense.id}><span className="expense-bullet">−</span><div><strong>{expense.description}</strong><small>{expense.category} · {humanize(expense.method)} · {fmtTime(expense.createdAt)}</small></div><b className="negative">−{formatMoney(expense.amountCents, currency)}</b></div>)}</div>}</section></div>
          <section className="panel payment-summary-panel"><div className="panel-heading"><div><div className="section-kicker">SALES TENDERS</div><h2>Money received today</h2></div></div><div className="payment-summary-row"><span>Cash</span><strong>{formatMoney(data.metrics.cashSales, currency)}</strong><small>Included in drawer expected</small></div><div className="payment-summary-row"><span>Card</span><strong>{formatMoney(data.metrics.cardSales, currency)}</strong><small>Outside the cash drawer</small></div><div className="payment-summary-row"><span>Bank / digital</span><strong>{formatMoney(data.metrics.bankSales, currency)}</strong><small>Outside the cash drawer</small></div><div className="payment-summary-row"><span>Debt repayments</span><strong>{formatMoney(data.metrics.debtCollectedToday, currency)}</strong><small>Recorded against customer balances</small></div><div className="payment-summary-total"><span>All sales</span><strong>{formatMoney(data.metrics.totalSales, currency)}</strong></div></section>
        </>}

        {section === "debts" && <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> CUSTOMER ACCOUNTS</div><h1>Debt book<span className="heading-period">.</span></h1><p>Track credit sales by person and record repayments as they come in.</p></div><Dialog title="Add a customer" description="Keep their name and optional phone number with their account history." trigger={<button className="button button-primary"><FiPlus aria-hidden="true" /> Add customer</button>}><form action={createDebtCustomer} className="form-stack modal-form"><label>Customer name<input name="name" required maxLength={100} autoComplete="name" /></label><label>Phone number <span className="optional-label">Optional</span><input name="phone" maxLength={32} inputMode="tel" autoComplete="tel" /></label><button className="button button-primary">Save customer</button></form></Dialog></section>
          <section className="debt-summary-grid"><article className="debt-summary-card"><span>Outstanding balance</span><strong>{formatMoney(data.metrics.debtOutstanding, currency)}</strong><small>Across all customer accounts</small></article><article className="debt-summary-card"><span>Credit sold today</span><strong>{formatMoney(data.metrics.debtSalesToday, currency)}</strong><small>Added to customer balances</small></article><article className="debt-summary-card"><span>Collected today</span><strong>{formatMoney(data.metrics.debtCollectedToday, currency)}</strong><small>Repayments recorded today</small></article></section>
          <section className="panel debt-book-panel"><div className="panel-heading"><div><div className="section-kicker">CUSTOMER LEDGER</div><h2>People and balances</h2></div><Badge>{data.customers.length} accounts</Badge></div><p className="panel-intro">Record repayments against each sale. Cash repayments are included in today&apos;s drawer.</p>{data.customers.length === 0 ? <div className="empty-state compact-empty"><span className="empty-icon"><FiBookOpen aria-hidden="true" /></span><strong>No customer accounts yet</strong><span>Choose “On account” during checkout or add a customer to start their book.</span></div> : <div className="debt-customer-list">{data.customers.map((customer) => <article className="debt-customer-card" key={customer.id}><div className="debt-customer-head"><span className="team-avatar">{customer.name.slice(0, 1).toUpperCase()}</span><div className="debt-customer-info"><strong>{customer.name}</strong><small>{customer.phone || "No phone number"} · {customer.sales.length} credit sale{customer.sales.length === 1 ? "" : "s"}</small></div><div className="debt-customer-balance"><small>{customer.balanceCents > 0 ? "OWES" : "SETTLED"}</small><strong>{formatMoney(customer.balanceCents, currency)}</strong></div></div>{customer.sales.length === 0 ? <p className="debt-no-sales">No credit sales recorded yet.</p> : <div className="debt-sale-list">{customer.sales.map((sale) => { const balance = sale.creditCents - sale.paidCents; return <div className="debt-sale-row" key={sale.id}><div><strong>{shortDate(sale.businessDate)} · Sale {sale.id.slice(-6).toUpperCase()}</strong><small>Credit {formatMoney(sale.creditCents, currency)} · Paid {formatMoney(sale.paidCents, currency)}</small>{sale.payments.map((payment) => <small className="debt-repayment-item" key={payment.id}>Payment · {shortDate(payment.businessDate)} · {humanize(payment.method)} · {formatMoney(payment.amountCents, currency)}</small>)}</div><div className="debt-sale-balance"><strong>{formatMoney(balance, currency)}</strong>{balance > 0 && <Dialog title={`Record payment · ${customer.name}`} description={`Outstanding on this sale: ${formatMoney(balance, currency)}.`} trigger={data.cashDay?.status === "OPEN" ? <button type="button" className="small-save">Record payment</button> : <button type="button" className="small-save" disabled>Open drawer first</button>}><form action={recordDebtPayment} className="form-stack modal-form"><input type="hidden" name="saleId" value={sale.id} /><label>Amount ({currency})<input name="amount" type="number" min={step} max={(balance / factor).toFixed(digits)} step={step} required defaultValue={(balance / factor).toFixed(digits)} /></label><label>Received by<SearchableSelect name="method" defaultValue="CASH" required options={paymentOptions} /></label><button className="button button-primary">Save payment</button></form></Dialog>}</div></div>; })}</div>}</article>)}</div>}</section>
        </>}

        {section === "settings" && data.user.role === "OWNER" && <>
          <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot" /> STORE ACCESS</div><h1>Team & devices<span className="heading-period">.</span></h1><p>Give your team the right access, and stay in control of signed-in devices.</p></div><Badge tone="brand">{data.users.length} team members</Badge></section>
          <section className="panel store-settings-panel"><div className="panel-heading"><div><div className="section-kicker">STORE PROFILE</div><h2>Store details</h2></div></div><form action={updateStoreSettings} className="store-settings-form"><label>Store name<input name="storeName" defaultValue={data.store.name} required maxLength={100} /></label><label>Time zone<input name="timezone" defaultValue={data.store.timezone} required /></label><label>Currency<input value={currency} readOnly aria-readonly="true" /></label><button className="button button-outline">Save store details </button><small>Currency is fixed after setup to keep historical amounts consistent.</small></form></section>
          <section className="settings-grid"><article className="panel"><div className="panel-heading"><div><div className="section-kicker">TEAM</div><h2>Your people</h2></div><Dialog title="Invite a team member" description="We’ll email them a secure link to set up their own password. The invitation expires after 72 hours." trigger={<button className="button button-outline team-add-trigger"><FiPlus aria-hidden="true" /> Invite member</button>}><form action={inviteStaffUser} className="form-stack add-user-form modal-form"><label>Full name<input name="name" required maxLength={100} autoComplete="name" /></label><label>Email<input name="email" type="email" required maxLength={254} autoComplete="email" /></label><label>Role<SearchableSelect name="role" defaultValue="CASHIER" required options={roleOptions} /></label><button className="button button-primary">Send invitation <FiPlus aria-hidden="true" /></button></form></Dialog></div><p className="panel-intro">Invite links expire after 72 hours. Team members choose their own password.</p><div className="team-list">{data.users.map((person) => <div className="team-row" key={person.id}><span className="team-avatar">{person.name.slice(0, 1).toUpperCase()}</span><div className="team-member"><strong>{person.name}</strong><small>{person.email}</small></div><Badge tone={person.role === "OWNER" ? "brand" : "neutral"}>{humanize(person.role)}</Badge>{person.id !== data.user.id && <Dialog title={`Change ${person.name}’s role`} description="Choose their access level. They’ll be signed out on all devices so the new permissions apply when they sign in again." trigger={<button type="button" className="small-save">Change role</button>}><form action={updateStaffRole} className="form-stack modal-form"><input type="hidden" name="userId" value={person.id} /><label>Role<SearchableSelect name="role" defaultValue={person.role} required options={roleOptions} /></label><button className="button button-primary">Save role</button></form></Dialog>}<form action={revokeAllDeviceSessions}><input type="hidden" name="userId" value={person.id} /><button className="small-save" disabled={person.id === data.user.id}>Sign out devices</button></form>{person.id !== data.user.id && <Dialog title={`Reset ${person.name}’s password?`} description={`We’ll email a one-time password setup link to ${person.email}. It will expire after one hour and revoke their existing sessions when used.`} trigger={<button className="small-save password-reset-trigger">Send reset link</button>}><form action={sendStaffPasswordReset} className="form-stack modal-form"><input type="hidden" name="userId" value={person.id} /><p className="reset-confirm-copy">A secure reset link will be sent to <strong>{person.email}</strong>. They’ll choose their new password themselves.</p><button className="button button-primary">Email reset link</button></form></Dialog>}</div>)}</div></article>
            <article className="panel devices-panel"><div className="panel-heading"><div><div className="section-kicker">ACTIVE SESSIONS</div><h2>Signed-in devices</h2></div><span className="device-count">{data.deviceSessions.length}</span></div><p className="panel-intro">Revoke a device at any time. Its next request will require a fresh sign-in.</p>{data.deviceSessions.length === 0 ? <div className="empty-state compact-empty"><span className="empty-icon"><FiLock aria-hidden="true" /></span><strong>No active devices</strong><span>Signed-in devices will appear here.</span></div> : <div className="device-list">{data.deviceSessions.map((device) => <div className="device-row" key={device.id}><span className="device-icon"><FiSmartphone aria-hidden="true" /></span><div className="device-info"><strong>{device.deviceName}{device.userId === data.user.id ? <span className="you-label">YOU</span> : null}</strong><small>{device.userName} · {humanize(device.role)}</small><small>Active {fmtTime(device.lastSeenAt)} · expires {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(device.expiresAt))}</small></div><form action={revokeDeviceSession}><input type="hidden" name="id" value={device.id} /><button className="revoke-button" title="Revoke this session" aria-label={`Revoke ${device.deviceName}`}><FiX aria-hidden="true" /></button></form></div>)}</div>}</article></section>
          <section className="panel roles-panel"><div className="panel-heading"><div><div className="section-kicker">PERMISSION GUIDE</div><h2>Roles at a glance</h2></div></div><div className="role-grid"><div><Badge tone="brand">Admin</Badge><p>Everything, including team access and device revocation.</p></div><div><Badge>Manager</Badge><p>Products, pricing, stock, expenses, cashflow and reporting.</p></div><div><Badge tone="orange">Cashier</Badge><p>Checkout, daily drawer counts and cash movements.</p></div></div></section>
        </>}
        {section === "settings" && data.user.role !== "OWNER" && <section className="empty-state"><span className="empty-icon"><FiLock aria-hidden="true" /></span><strong>Owner access required</strong><span>Team and device settings are available to the store owner.</span></section>}
      </div>
      <footer className="page-footer"><a className="built-by" href="https://macm.lk" target="_blank" rel="noreferrer"><span className="macm-icon" aria-hidden="true" /><span>Built by <strong>macm.lk</strong></span></a><span>Store day · {data.today} <i>·</i> {data.store.timezone}</span></footer>
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.filter((item) => !item.owner || data.user.role === "OWNER").map((item) => <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => setSection(item.id)}><span><item.icon aria-hidden="true" /></span><small>{item.id === "overview" ? "Home" : item.id === "settings" ? "Team" : item.label}</small></button>)}</nav>
  </div>;
}
