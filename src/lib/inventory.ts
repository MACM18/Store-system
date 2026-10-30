export type CostedLot = { id: string; quantityRemaining: number; unitCostCents: number };

export function planFifoConsumption(lots: CostedLot[], quantity: number) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Quantity must be a positive integer");
  let remaining = quantity;
  let totalCostCents = 0;
  const allocations: Array<{ id: string; quantity: number }> = [];
  for (const lot of lots) {
    if (!Number.isSafeInteger(lot.quantityRemaining) || lot.quantityRemaining < 0 || !Number.isSafeInteger(lot.unitCostCents) || lot.unitCostCents < 0) throw new Error("Invalid stock lot");
    if (!remaining) break;
    const used = Math.min(remaining, lot.quantityRemaining);
    if (used > 0) {
      allocations.push({ id: lot.id, quantity: used });
      totalCostCents += used * lot.unitCostCents;
      remaining -= used;
    }
  }
  if (remaining > 0 || !Number.isSafeInteger(totalCostCents)) throw new Error("Not enough costed stock");
  return { allocations, totalCostCents };
}
