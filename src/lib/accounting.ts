export function expectedDrawerCash(opening: number, cashSales: number, cashExpenses: number, cashIn: number, cashOut: number) {
  return opening + cashSales - cashExpenses + cashIn - cashOut;
}

export function paymentTotalMatches(total: number, amounts: number[]) {
  return amounts.every((amount) => Number.isSafeInteger(amount) && amount >= 0) && amounts.reduce((sum, amount) => sum + amount, 0) === total;
}
