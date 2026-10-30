"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { hashPassword, verifyPassword, createDeviceSession, requireRole, endCurrentSession } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { expectedDrawerCash, paymentTotalMatches } from "@/lib/accounting";
import { planFifoConsumption } from "@/lib/inventory";
import { parseMoney } from "@/lib/money";
import { prisma } from "@/lib/prisma";

const text = (form: FormData, key: string, max = 200) => Array.from(String(form.get(key) ?? "").normalize("NFC").trim()).slice(0, max).join("");
const integer = (form: FormData, key: string) => {
  const value = String(form.get(key) ?? "");
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
const method = (value: string) => value === "CARD" || value === "BANK" ? value : "CASH";

export async function setupStore(form: FormData) {
  const storeName = text(form, "storeName", 100);
  const name = text(form, "name", 100);
  const email = text(form, "email", 254).toLowerCase();
  const password = String(form.get("password") ?? "");
  const currency = text(form, "currency", 3).toUpperCase();
  const timezone = text(form, "timezone", 80);
  if (!storeName || !name || !/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || !/^[A-Z]{3}$/.test(currency) || !timezone) redirect("/setup?error=invalid");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { redirect("/setup?error=timezone"); }
  const passwordHash = await hashPassword(password);
  try {
    const user = await prisma.$transaction(async (tx) => {
      await tx.setupClaim.create({ data: { id: 1 } });
      const store = await tx.store.create({ data: { name: storeName, currency, timezone } });
      return tx.user.create({ data: { storeId: store.id, name, email, passwordHash, role: "OWNER" } });
    }, { isolationLevel: "Serializable" });
    await createDeviceSession(user.id);
  } catch {
    redirect("/setup?error=complete");
  }
  redirect("/");
}

export async function login(form: FormData) {
  const email = text(form, "email", 254).toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) redirect("/login?error=credentials");
  await createDeviceSession(user.id);
  redirect("/");
}

export async function logout() {
  await endCurrentSession();
  redirect("/login");
}

export async function createProduct(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER");
  const name = text(form, "name", 120);
  const sku = text(form, "sku", 60).toUpperCase();
  const category = text(form, "category", 60) || "General";
  const stock = integer(form, "stock");
  const lowStockAt = integer(form, "lowStockAt") ?? 5;
  const priceCents = parseMoney(form.get("price"), session.user.store.currency);
  const costRaw = String(form.get("cost") ?? "").trim();
  const costCents = costRaw ? parseMoney(costRaw, session.user.store.currency) : null;
  if (!name || !sku || stock === null || stock < 0 || lowStockAt < 0 || priceCents === null || priceCents < 1 || costCents === null) redirect("/?section=inventory&error=product");
  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({ data: { storeId: session.user.storeId, name, sku, category, stock, lowStockAt, priceCents, costCents } });
      if (stock > 0) await tx.stockLot.create({ data: { productId: product.id, receivedById: session.userId, quantityReceived: stock, quantityRemaining: stock, unitCostCents: costCents } });
      await tx.auditEvent.create({ data: { storeId: session.user.storeId, actorId: session.userId, action: "PRODUCT_CREATED", metadata: { productId: product.id, sku } } });
    });
  } catch { redirect("/?section=inventory&error=sku"); }
  revalidatePath("/");
  redirect("/?section=inventory&success=product");
}

export async function updateProduct(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER");
  const id = text(form, "id", 40);
  const name = text(form, "name", 120);
  const priceCents = parseMoney(form.get("price"), session.user.store.currency);
  const costCents = parseMoney(form.get("cost"), session.user.store.currency);
  const lowStockAt = integer(form, "lowStockAt");
  if (!id || !name || priceCents === null || priceCents < 1 || costCents === null || lowStockAt === null || lowStockAt < 0) redirect("/?section=inventory&error=product");
  await prisma.product.updateMany({ where: { id, storeId: session.user.storeId }, data: { name, priceCents, costCents, lowStockAt } });
  await prisma.auditEvent.create({ data: { storeId: session.user.storeId, actorId: session.userId, action: "PRODUCT_PRICE_UPDATED", metadata: { productId: id, priceCents, costCents } } });
  revalidatePath("/");
  redirect("/?section=inventory&success=price");
}

export async function receiveStock(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER");
  const productId = text(form, "productId", 40);
  const quantity = integer(form, "quantity");
  const unitCostCents = parseMoney(form.get("unitCost"), session.user.store.currency);
  const paymentMethod = method(text(form, "method", 8));
  const note = text(form, "note", 180) || "Stock replenishment";
  if (!productId || quantity === null || quantity < 1 || unitCostCents === null) redirect("/?section=inventory&error=restock");
  const total = quantity * unitCostCents;
  if (!Number.isSafeInteger(total)) redirect("/?section=inventory&error=restock");
  try {
    await prisma.$transaction(async (tx) => {
      await ensureOpenCashDay(tx, session.user.storeId, session.user.store.timezone);
      const product = await tx.product.findFirst({ where: { id: productId, storeId: session.user.storeId } });
      if (!product) throw new Error("Product not found");
      await tx.product.update({ where: { id: product.id }, data: { stock: { increment: quantity }, costCents: unitCostCents } });
      const expense = await tx.expense.create({ data: { storeId: session.user.storeId, createdById: session.userId, category: "Inventory purchase", description: `${product.name} · ${note}`, method: paymentMethod, amountCents: total, businessDate: businessDate(session.user.store.timezone) } });
      await tx.stockLot.create({ data: { productId, receivedById: session.userId, quantityReceived: quantity, quantityRemaining: quantity, unitCostCents, expenseId: expense.id } });
      await tx.auditEvent.create({ data: { storeId: session.user.storeId, actorId: session.userId, action: "STOCK_RECEIVED", metadata: { productId, quantity, unitCostCents, total } } });
    }, { isolationLevel: "Serializable" });
  } catch { redirect("/?section=inventory&error=restock"); }
  revalidatePath("/");
  redirect("/?section=inventory&success=restock");
}

export async function adjustStock(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER");
  const productId = text(form, "productId", 40);
  const delta = Number(String(form.get("delta") ?? ""));
  const reason = text(form, "reason", 180);
  if (!productId || !Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 100000 || reason.length < 3) redirect("/?section=inventory&error=adjustment");
  try {
    await prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id: productId, storeId: session.user.storeId } });
      if (!product) throw new Error("Product not found");
      if (delta < 0) {
        const quantity = -delta;
        const changed = await tx.product.updateMany({ where: { id: productId, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
        if (!changed.count) throw new Error("Insufficient stock");
        await consumeLots(tx, productId, quantity);
      } else {
        await tx.product.update({ where: { id: productId }, data: { stock: { increment: delta } } });
        await tx.stockLot.create({ data: { productId, receivedById: session.userId, quantityReceived: delta, quantityRemaining: delta, unitCostCents: product.costCents ?? 0 } });
      }
      await tx.stockAdjustment.create({ data: { productId, userId: session.userId, delta, reason } });
      await tx.auditEvent.create({ data: { storeId: session.user.storeId, actorId: session.userId, action: "STOCK_ADJUSTED", metadata: { productId, delta, reason } } });
    }, { isolationLevel: "Serializable" });
  } catch { redirect("/?section=inventory&error=adjustment"); }
  revalidatePath("/");
  redirect("/?section=inventory&success=adjustment");
}

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function consumeLots(tx: TransactionClient, productId: string, quantity: number) {
  const lots = await tx.stockLot.findMany({ where: { productId, quantityRemaining: { gt: 0 } }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] });
  const plan = planFifoConsumption(lots, quantity);
  for (const allocation of plan.allocations) {
    const changed = await tx.stockLot.updateMany({ where: { id: allocation.id, quantityRemaining: { gte: allocation.quantity } }, data: { quantityRemaining: { decrement: allocation.quantity } } });
    if (!changed.count) throw new Error("Stock changed during transaction");
  }
}

export async function checkout(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER", "CASHIER");
  let cart: Array<{ productId: string; quantity: number }>;
  try { cart = JSON.parse(String(form.get("cart") ?? "[]")); } catch { redirect("/?section=checkout&error=cart"); }
  if (!Array.isArray(cart) || cart.length < 1 || cart.length > 40) redirect("/?section=checkout&error=cart");
  const combined = new Map<string, number>();
  for (const line of cart) {
    if (!line || typeof line.productId !== "string" || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000) redirect("/?section=checkout&error=cart");
    combined.set(line.productId, (combined.get(line.productId) ?? 0) + line.quantity);
  }
  const payments = ["CASH", "CARD", "BANK"].map((name) => ({ method: name as "CASH" | "CARD" | "BANK", amountCents: parseMoney(form.get(name.toLowerCase()), session.user.store.currency) ?? 0 }));
  const today = businessDate(session.user.store.timezone);
  try {
    await prisma.$transaction(async (tx) => {
      const day = await tx.cashSession.findUnique({ where: { storeId_businessDate: { storeId: session.user.storeId, businessDate: today } } });
      if (!day || day.status !== "OPEN") throw new Error("Open today's cash drawer first");
      const products = await tx.product.findMany({ where: { id: { in: [...combined.keys()] }, storeId: session.user.storeId, active: true } });
      if (products.length !== combined.size) throw new Error("Product unavailable");
      const lines = products.map((product) => ({ product, quantity: combined.get(product.id)! }));
      const total = lines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
      if (!Number.isSafeInteger(total) || !paymentTotalMatches(total, payments.map((payment) => payment.amountCents))) throw new Error("Payment total must match sale total");
      const sale = await tx.sale.create({ data: { storeId: session.user.storeId, cashierId: session.userId, totalCents: total, businessDate: today } });
      for (const { product, quantity } of lines) {
        const changed = await tx.product.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
        if (!changed.count) throw new Error(`Not enough stock for ${product.name}`);
        const cost = await consumeLotsAndCost(tx, product.id, quantity);
        await tx.saleItem.create({ data: { saleId: sale.id, productId: product.id, productName: product.name, quantity, unitPriceCents: product.priceCents, unitCostCents: Math.round(cost.totalCents / quantity), lineCostCents: cost.totalCents, lineTotalCents: product.priceCents * quantity } });
      }
      await tx.salePayment.createMany({ data: payments.filter((payment) => payment.amountCents > 0).map((payment) => ({ saleId: sale.id, ...payment })) });
      await tx.auditEvent.create({ data: { storeId: session.user.storeId, actorId: session.userId, action: "SALE_COMPLETED", metadata: { saleId: sale.id, total } } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    const code = error instanceof Error && error.message.includes("drawer") ? "drawer" : "checkout";
    redirect(`/?section=checkout&error=${code}`);
  }
  revalidatePath("/");
  redirect("/?section=checkout&success=sale");
}

async function consumeLotsAndCost(tx: TransactionClient, productId: string, quantity: number) {
  const lots = await tx.stockLot.findMany({ where: { productId, quantityRemaining: { gt: 0 } }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] });
  const plan = planFifoConsumption(lots, quantity);
  for (const allocation of plan.allocations) {
    const changed = await tx.stockLot.updateMany({ where: { id: allocation.id, quantityRemaining: { gte: allocation.quantity } }, data: { quantityRemaining: { decrement: allocation.quantity } } });
    if (!changed.count) throw new Error("Stock changed during checkout");
  }
  return { totalCents: plan.totalCostCents };
}

export async function addExpense(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER");
  const category = text(form, "category", 60);
  const description = text(form, "description", 180);
  const amountCents = parseMoney(form.get("amount"), session.user.store.currency);
  const paymentMethod = method(text(form, "method", 8));
  if (!category || !description || amountCents === null || amountCents < 1) redirect("/?section=cashflow&error=expense");
  try {
    await prisma.$transaction(async (tx) => {
      const day = await ensureOpenCashDay(tx, session.user.storeId, session.user.store.timezone);
      await tx.expense.create({ data: { storeId: session.user.storeId, createdById: session.userId, category, description, method: paymentMethod, amountCents, businessDate: day.businessDate } });
    }, { isolationLevel: "Serializable" });
  } catch { redirect("/?section=cashflow&error=drawer"); }
  revalidatePath("/");
  redirect("/?section=cashflow&success=expense");
}

export async function recordCashMovement(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER", "CASHIER");
  const kind = text(form, "kind", 8) === "CASH_OUT" ? "CASH_OUT" : "CASH_IN";
  const reason = text(form, "reason", 180);
  const amountCents = parseMoney(form.get("amount"), session.user.store.currency);
  if (!reason || amountCents === null || amountCents < 1) redirect("/?section=cashflow&error=movement");
  try {
    await prisma.$transaction(async (tx) => {
      const day = await ensureOpenCashDay(tx, session.user.storeId, session.user.store.timezone);
      await tx.cashMovement.create({ data: { storeId: session.user.storeId, createdById: session.userId, kind, reason, amountCents, businessDate: day.businessDate } });
    }, { isolationLevel: "Serializable" });
  } catch { redirect("/?section=cashflow&error=movement"); }
  revalidatePath("/");
  redirect("/?section=cashflow&success=movement");
}

export async function openCashDay(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER", "CASHIER");
  const openingCash = parseMoney(form.get("openingCash"), session.user.store.currency);
  if (openingCash === null) redirect("/?section=cashflow&error=opening");
  const today = businessDate(session.user.store.timezone);
  try { await prisma.cashSession.create({ data: { storeId: session.user.storeId, businessDate: today, openingCash, openedById: session.userId } }); }
  catch { redirect("/?section=cashflow&error=already-open"); }
  revalidatePath("/");
  redirect("/?section=cashflow&success=open");
}

export async function closeCashDay(form: FormData) {
  const session = await requireRole("OWNER", "MANAGER", "CASHIER");
  const countedCash = parseMoney(form.get("countedCash"), session.user.store.currency);
  if (countedCash === null) redirect("/?section=cashflow&error=count");
  const today = businessDate(session.user.store.timezone);
  await prisma.$transaction(async (tx) => {
    const day = await tx.cashSession.findUnique({ where: { storeId_businessDate: { storeId: session.user.storeId, businessDate: today } } });
    if (!day || day.status !== "OPEN") throw new Error("No open cash day");
    const [sales, expenses, movements] = await Promise.all([
      tx.salePayment.aggregate({ where: { sale: { storeId: session.user.storeId, businessDate: today }, method: "CASH" }, _sum: { amountCents: true } }),
      tx.expense.aggregate({ where: { storeId: session.user.storeId, businessDate: today, method: "CASH" }, _sum: { amountCents: true } }),
      tx.cashMovement.groupBy({ by: ["kind"], where: { storeId: session.user.storeId, businessDate: today }, _sum: { amountCents: true } }),
    ]);
    const inTotal = movements.find((item) => item.kind === "CASH_IN")?._sum.amountCents ?? 0;
    const outTotal = movements.find((item) => item.kind === "CASH_OUT")?._sum.amountCents ?? 0;
    const expectedCash = expectedDrawerCash(day.openingCash, sales._sum.amountCents ?? 0, expenses._sum.amountCents ?? 0, inTotal, outTotal);
    await tx.cashSession.update({ where: { id: day.id }, data: { countedCash, expectedCash, status: "CLOSED", closedById: session.userId, closedAt: new Date() } });
  });
  revalidatePath("/");
  redirect("/?section=cashflow&success=closed");
}

async function ensureOpenCashDay(tx: TransactionClient, storeId: string, timezone: string) {
  const today = businessDate(timezone);
  const day = await tx.cashSession.findUnique({ where: { storeId_businessDate: { storeId, businessDate: today } } });
  if (!day || day.status !== "OPEN") throw new Error("Open today's cash drawer first");
  return day;
}

export async function createStaffUser(form: FormData) {
  const session = await requireRole("OWNER");
  const name = text(form, "name", 100);
  const email = text(form, "email", 254).toLowerCase();
  const role = text(form, "role", 10);
  const password = String(form.get("password") ?? "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || (role !== "MANAGER" && role !== "CASHIER") || password.length < 12) redirect("/?section=settings&error=user");
  try { await prisma.user.create({ data: { storeId: session.user.storeId, name, email, role, passwordHash: await hashPassword(password) } }); }
  catch { redirect("/?section=settings&error=email"); }
  revalidatePath("/");
  redirect("/?section=settings&success=user");
}

export async function updateStoreSettings(form: FormData) {
  const session = await requireRole("OWNER");
  const name = text(form, "storeName", 100);
  const timezone = text(form, "timezone", 80);
  if (!name || !timezone) redirect("/?section=settings&error=store");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
  catch { redirect("/?section=settings&error=store"); }
  await prisma.store.update({ where: { id: session.user.storeId }, data: { name, timezone } });
  revalidatePath("/");
  redirect("/?section=settings&success=store");
}

export async function revokeDeviceSession(form: FormData) {
  const session = await requireRole("OWNER");
  const id = text(form, "id", 40);
  if (id) await prisma.deviceSession.updateMany({ where: { id, user: { storeId: session.user.storeId }, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath("/");
  redirect("/?section=settings");
}

export async function revokeAllDeviceSessions(form: FormData) {
  const session = await requireRole("OWNER");
  const userId = text(form, "userId", 40);
  if (userId && userId !== session.userId) await prisma.deviceSession.updateMany({ where: { userId, user: { storeId: session.user.storeId }, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath("/");
  redirect("/?section=settings");
}
