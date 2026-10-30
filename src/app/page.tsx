import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import { businessDate, previousBusinessDate } from "@/lib/dates";
import { expectedDrawerCash } from "@/lib/accounting";
import { prisma } from "@/lib/prisma";
import { StoreApp } from "@/components/store-app";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ section?: string; success?: string; error?: string }> }) {
  const storeExists = await prisma.store.findFirst({ select: { id: true } });
  if (!storeExists) redirect("/setup");
  const session = await getCurrentSession();
  if (!session) redirect("/login");

  const { section, success, error } = await searchParams;
  const store = session.user.store;
  const today = businessDate(store.timezone);
  const weekStart = previousBusinessDate(today, 6);
  const [products, cashDay, sales, expenses, movements, weeklySales, weeklyExpenses, paymentTotals, debtPaymentTotals, customers, recentSales, users, deviceSessions] = await Promise.all([
    prisma.product.findMany({ where: { storeId: store.id, active: true }, orderBy: { name: "asc" } }),
    prisma.cashSession.findUnique({ where: { storeId_businessDate: { storeId: store.id, businessDate: today } } }),
    prisma.sale.findMany({ where: { storeId: store.id, businessDate: today }, include: { items: true, payments: true }, orderBy: { createdAt: "desc" } }),
    prisma.expense.findMany({ where: { storeId: store.id, businessDate: today }, orderBy: { createdAt: "desc" } }),
    prisma.cashMovement.findMany({ where: { storeId: store.id, businessDate: today }, orderBy: { createdAt: "desc" } }),
    prisma.sale.groupBy({ by: ["businessDate"], where: { storeId: store.id, businessDate: { gte: weekStart, lte: today } }, _sum: { totalCents: true } }),
    prisma.expense.groupBy({ by: ["businessDate"], where: { storeId: store.id, businessDate: { gte: weekStart, lte: today } }, _sum: { amountCents: true } }),
    prisma.salePayment.groupBy({ by: ["method"], where: { sale: { storeId: store.id, businessDate: today } }, _sum: { amountCents: true } }),
    prisma.debtPayment.groupBy({ by: ["method"], where: { customer: { storeId: store.id }, businessDate: today }, _sum: { amountCents: true } }),
    prisma.customer.findMany({ where: { storeId: store.id }, orderBy: { name: "asc" }, include: { sales: { where: { creditCents: { gt: 0 } }, include: { debtPayments: { orderBy: { createdAt: "desc" } } }, orderBy: { createdAt: "desc" } } } }),
    prisma.sale.findMany({ where: { storeId: store.id, businessDate: today }, include: { items: true, payments: true }, orderBy: { createdAt: "desc" }, take: 7 }),
    session.user.role === "OWNER" ? prisma.user.findMany({ where: { storeId: store.id }, orderBy: [{ role: "asc" }, { name: "asc" }] }) : Promise.resolve([]),
    session.user.role === "OWNER" ? prisma.deviceSession.findMany({ where: { user: { storeId: store.id }, revokedAt: null, expiresAt: { gt: new Date() } }, include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { lastSeenAt: "desc" } }) : Promise.resolve([]),
  ]);

  const paymentMap = Object.fromEntries(paymentTotals.map((row) => [row.method, row._sum.amountCents ?? 0]));
  const debtPaymentMap = Object.fromEntries(debtPaymentTotals.map((row) => [row.method, row._sum.amountCents ?? 0]));
  const cashExpenses = expenses.filter((expense) => expense.method === "CASH").reduce((sum, expense) => sum + expense.amountCents, 0);
  const cashIn = movements.filter((movement) => movement.kind === "CASH_IN").reduce((sum, movement) => sum + movement.amountCents, 0);
  const cashOut = movements.filter((movement) => movement.kind === "CASH_OUT").reduce((sum, movement) => sum + movement.amountCents, 0);
  const expectedCash = cashDay ? expectedDrawerCash(cashDay.openingCash, (paymentMap.CASH ?? 0) + (debtPaymentMap.CASH ?? 0), cashExpenses, cashIn, cashOut) : 0;
  const totalSales = sales.reduce((sum, sale) => sum + sale.totalCents, 0);
  const debtSalesToday = sales.reduce((sum, sale) => sum + sale.creditCents, 0);
  const debtCollectedToday = Object.values(debtPaymentMap).reduce((sum, amount) => sum + amount, 0);
  const debtOutstanding = customers.reduce((sum, customer) => sum + customer.sales.reduce((customerSum, sale) => customerSum + sale.creditCents - sale.debtPayments.reduce((paid, payment) => paid + payment.amountCents, 0), 0), 0);
  const collectedToday = Object.values(paymentMap).reduce((sum, amount) => sum + amount, 0) + debtCollectedToday;
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const costOfGoods = sales.flatMap((sale) => sale.items).reduce((sum, item) => sum + item.lineCostCents, 0);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = previousBusinessDate(today, 6 - index);
    return { date, sales: weeklySales.find((item) => item.businessDate === date)?._sum.totalCents ?? 0, expenses: weeklyExpenses.find((item) => item.businessDate === date)?._sum.amountCents ?? 0 };
  });
  const lowStockCount = products.filter((product) => product.stock <= product.lowStockAt).length;

  return <StoreApp data={{
    store: { id: store.id, name: store.name, currency: store.currency, timezone: store.timezone },
    user: { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role },
    today, section: section ?? "overview", success, error,
    products: products.map((item) => ({ ...item, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
    cashDay: cashDay ? { ...cashDay, openedAt: cashDay.openedAt.toISOString(), closedAt: cashDay.closedAt?.toISOString() ?? null } : null,
    metrics: { totalSales, totalExpenses, net: collectedToday + cashIn - totalExpenses - cashOut, collectedToday, cashExpected: expectedCash, cashCounted: cashDay?.countedCash ?? null, cashVariance: cashDay?.countedCash === null || cashDay?.countedCash === undefined ? null : cashDay.countedCash - (cashDay.expectedCash ?? expectedCash), cashSales: (paymentMap.CASH ?? 0) + (debtPaymentMap.CASH ?? 0), cardSales: (paymentMap.CARD ?? 0) + (debtPaymentMap.CARD ?? 0), bankSales: (paymentMap.BANK ?? 0) + (debtPaymentMap.BANK ?? 0), debtSalesToday, debtCollectedToday, debtOutstanding, costOfGoods, grossProfit: totalSales - costOfGoods, lowStockCount, saleCount: sales.length },
    week,
    expenses: expenses.slice(0, 12).map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    movements: movements.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
    recentSales: recentSales.map((sale) => ({ id: sale.id, totalCents: sale.totalCents, createdAt: sale.createdAt.toISOString(), itemCount: sale.items.reduce((count, item) => count + item.quantity, 0), methods: sale.creditCents > 0 ? ["ON_ACCOUNT"] : [...new Set(sale.payments.map((payment) => payment.method))] })),
    customers: customers.map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone, balanceCents: customer.sales.reduce((sum, sale) => sum + sale.creditCents - sale.debtPayments.reduce((paid, payment) => paid + payment.amountCents, 0), 0), sales: customer.sales.map((sale) => ({ id: sale.id, totalCents: sale.totalCents, creditCents: sale.creditCents, paidCents: sale.debtPayments.reduce((sum, payment) => sum + payment.amountCents, 0), businessDate: sale.businessDate, createdAt: sale.createdAt.toISOString(), payments: sale.debtPayments.map((payment) => ({ id: payment.id, amountCents: payment.amountCents, method: payment.method, businessDate: payment.businessDate })) })) })),
    users: users.map((item) => ({ id: item.id, name: item.name, email: item.email, role: item.role, active: item.active, createdAt: item.createdAt.toISOString() })),
    deviceSessions: deviceSessions.map((item) => ({ id: item.id, userId: item.userId, userName: item.user.name, role: item.user.role, deviceName: item.deviceName, createdAt: item.createdAt.toISOString(), lastSeenAt: item.lastSeenAt.toISOString(), expiresAt: item.expiresAt.toISOString() })),
  }} />;
}
