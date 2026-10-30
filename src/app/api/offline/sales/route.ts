import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/auth";
import { businessDate } from "@/lib/dates";
import { paymentTotalMatches } from "@/lib/accounting";
import { planFifoConsumption } from "@/lib/inventory";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SalePayload = {
  id: string;
  storeId: string;
  userId: string;
  createdAt: string;
  lines: Array<{ productId: string; name: string; priceCents: number; quantity: number }>;
  payments: { cash: number; card: number; bank: number };
};

class OfflineSaleConflict extends Error {}

function invalid(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return invalid("Sign in again before syncing saved sales.", 401);
  if (!session.user.active || !["OWNER", "MANAGER", "CASHIER"].includes(session.user.role)) return invalid("Your account cannot sync sales.", 403);

  let payload: SalePayload;
  try { payload = await request.json() as SalePayload; }
  catch { return invalid("Sale data is not valid JSON."); }

  if (!payload || typeof payload.id !== "string" || !/^[a-f\d-]{36}$/i.test(payload.id) || payload.storeId !== session.user.storeId || payload.userId !== session.userId || !Array.isArray(payload.lines) || payload.lines.length < 1 || payload.lines.length > 40) return invalid("Sign in to the same store account that saved this sale.", 403);
  const occurredAt = new Date(payload.createdAt);
  const now = new Date();
  if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > now.getTime() + 5 * 60_000 || occurredAt.getTime() < now.getTime() - 7 * 24 * 60 * 60_000) return invalid("This saved sale is outside the 7-day sync window.", 409);
  const linesByProduct = new Map<string, { productId: string; name: string; priceCents: number; quantity: number }>();
  for (const line of payload.lines) {
    if (!line || typeof line.productId !== "string" || !line.productId || typeof line.name !== "string" || !Number.isSafeInteger(line.priceCents) || line.priceCents < 1 || !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000) return invalid("A saved sale contains an invalid item.");
    const previous = linesByProduct.get(line.productId);
    linesByProduct.set(line.productId, { ...line, quantity: (previous?.quantity ?? 0) + line.quantity });
  }
  const paymentRows = [
    { method: "CASH" as const, amountCents: payload.payments?.cash },
    { method: "CARD" as const, amountCents: payload.payments?.card },
    { method: "BANK" as const, amountCents: payload.payments?.bank },
  ];
  if (paymentRows.some((payment) => !Number.isSafeInteger(payment.amountCents) || payment.amountCents < 0)) return invalid("Payment totals are not valid.");
  const storeId = session.user.storeId;
  const cashierId = session.userId;
  const date = businessDate(session.user.store.timezone, occurredAt);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const alreadySynced = await tx.sale.findUnique({ where: { storeId_offlineId: { storeId, offlineId: payload.id } }, select: { id: true } });
      if (alreadySynced) return { saleId: alreadySynced.id, duplicate: true };

      const day = await tx.cashSession.findUnique({ where: { storeId_businessDate: { storeId, businessDate: date } } });
      if (!day || day.status !== "OPEN") throw new OfflineSaleConflict("That day’s cash drawer is no longer open. Ask a manager to review this saved sale.");
      const productIds = [...linesByProduct.keys()];
      const products = await tx.product.findMany({ where: { id: { in: productIds }, storeId, active: true } });
      if (products.length !== linesByProduct.size) throw new OfflineSaleConflict("One or more saved products are no longer available. Review this sale with a manager.");
      const lines = products.map((product) => {
        const saved = linesByProduct.get(product.id)!;
        if (saved.priceCents !== product.priceCents) throw new OfflineSaleConflict(`${saved.name} has a different selling price now. Review this saved sale before recording it.`);
        return { product, quantity: saved.quantity };
      });
      const total = lines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
      if (!paymentTotalMatches(total, paymentRows.map((payment) => payment.amountCents))) throw new OfflineSaleConflict("The saved payment breakdown does not match this sale.");
      const sale = await tx.sale.create({ data: { storeId, cashierId, totalCents: total, businessDate: date, offlineId: payload.id, createdAt: occurredAt } });
      for (const { product, quantity } of lines) {
        const changed = await tx.product.updateMany({ where: { id: product.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
        if (!changed.count) throw new OfflineSaleConflict(`${product.name} no longer has enough stock. Review this saved sale with a manager.`);
        const lots = await tx.stockLot.findMany({ where: { productId: product.id, quantityRemaining: { gt: 0 } }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }] });
        let plan: ReturnType<typeof planFifoConsumption>;
        try { plan = planFifoConsumption(lots, quantity); }
        catch { throw new OfflineSaleConflict(`${product.name} has an inventory cost issue. Review this saved sale with a manager.`); }
        for (const allocation of plan.allocations) {
          const updated = await tx.stockLot.updateMany({ where: { id: allocation.id, quantityRemaining: { gte: allocation.quantity } }, data: { quantityRemaining: { decrement: allocation.quantity } } });
          if (!updated.count) throw new OfflineSaleConflict("Inventory changed while this sale was syncing. Please retry.");
        }
        await tx.saleItem.create({ data: { saleId: sale.id, productId: product.id, productName: product.name, quantity, unitPriceCents: product.priceCents, unitCostCents: Math.round(plan.totalCostCents / quantity), lineCostCents: plan.totalCostCents, lineTotalCents: product.priceCents * quantity } });
      }
      await tx.salePayment.createMany({ data: paymentRows.filter((payment) => payment.amountCents > 0).map((payment) => ({ saleId: sale.id, ...payment })) });
      await tx.auditEvent.create({ data: { storeId, actorId: cashierId, action: "SALE_COMPLETED_OFFLINE", metadata: { saleId: sale.id, offlineId: payload.id, total, syncedAt: now.toISOString() } } });
      return { saleId: sale.id, duplicate: false };
    }, { isolationLevel: "Serializable" });
    revalidatePath("/");
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const duplicate = await prisma.sale.findUnique({ where: { storeId_offlineId: { storeId, offlineId: payload.id } }, select: { id: true } });
      if (duplicate) return NextResponse.json({ ok: true, saleId: duplicate.id, duplicate: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const serializationConflict = !!error && typeof error === "object" && "code" in error && error.code === "P2034";
    const message = error instanceof OfflineSaleConflict ? error.message : serializationConflict ? "Another sale updated inventory at the same time. This sale will retry shortly." : "The sale could not be synced. Please retry.";
    return invalid(message, serializationConflict ? 503 : error instanceof OfflineSaleConflict ? 409 : 500);
  }
}
