import assert from "node:assert/strict";
import test from "node:test";
import { expectedDrawerCash, paymentTotalMatches } from "../src/lib/accounting.ts";
import { businessDate, previousBusinessDate } from "../src/lib/dates.ts";
import { planFifoConsumption } from "../src/lib/inventory.ts";
import { formatMoney, parseMoney } from "../src/lib/money.ts";

test("money parsing uses configured currency minor units and rejects malformed amounts", () => {
  assert.equal(parseMoney("12.34", "LKR"), 1234);
  assert.equal(parseMoney("12", "LKR"), 1200);
  assert.equal(parseMoney("1200", "JPY"), 1200);
  assert.equal(parseMoney("12.3", "JPY"), null);
  assert.equal(parseMoney("12.345", "LKR"), null);
  assert.equal(parseMoney("-1", "LKR"), null);
  assert.equal(parseMoney("999999999999999999", "LKR"), null);
  assert.equal(formatMoney(1234, "LKR"), "LKR 12.34");
});

test("business dates follow the store timezone across UTC midnight", () => {
  assert.equal(businessDate("Asia/Colombo", new Date("2026-10-29T20:00:00.000Z")), "2026-10-30");
  assert.equal(businessDate("America/Los_Angeles", new Date("2026-10-30T06:30:00.000Z")), "2026-10-29");
  assert.equal(previousBusinessDate("2026-03-01", 1), "2026-02-28");
  assert.equal(previousBusinessDate("2024-03-01", 1), "2024-02-29");
});

test("cash expected balance includes cash sales and movements but excludes non-cash tenders", () => {
  assert.equal(expectedDrawerCash(5000, 12400, 2300, 900, 1500), 14500);
  assert.equal(paymentTotalMatches(10000, [3000, 5000, 2000]), true);
  assert.equal(paymentTotalMatches(10000, [3000, 5000, 1500]), false);
  assert.equal(paymentTotalMatches(10000, [3000, -10, 7010]), false);
});

test("FIFO stock cost preserves each delivery price and rejects insufficient lots", () => {
  const result = planFifoConsumption([
    { id: "first", quantityRemaining: 3, unitCostCents: 150 },
    { id: "second", quantityRemaining: 4, unitCostCents: 200 },
  ], 4);
  assert.deepEqual(result.allocations, [{ id: "first", quantity: 3 }, { id: "second", quantity: 1 }]);
  assert.equal(result.totalCostCents, 650);
  assert.throws(() => planFifoConsumption([{ id: "first", quantityRemaining: 1, unitCostCents: 10 }], 2), /Not enough costed stock/);
});
