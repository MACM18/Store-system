export function currencyDigits(currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function parseMoney(value: FormDataEntryValue | null, currency: string) {
  if (typeof value !== "string") return null;
  const input = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(input)) return null;
  const digits = currencyDigits(currency);
  const [whole, fraction = ""] = input.split(".");
  if (fraction.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || 0);
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

export function moneyInputStep(currency: string) {
  const digits = currencyDigits(currency);
  return digits === 0 ? "1" : `0.${"0".repeat(Math.max(digits - 1, 0))}1`;
}

export function formatMoney(minor: number, currency: string) {
  const digits = currencyDigits(currency);
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(minor / 10 ** digits);
}
