// The stock ledger is append-only: nothing is ever edited or deleted. When the storekeeper
// changes a figure on the Daily Sheet (the way you'd overwrite a cell in Excel) the sheet
// records only the difference. A reduction is written as an opposite entry under the same
// reason — e.g. stock "out" with reason "restock" takes back some of that day's stock-in —
// so the original entry stays visible and everything nets out per reason.
export const isReversal = (e) => (e.type === "in" && e.reason !== "restock") || (e.type === "out" && e.reason === "restock");

// Signed amount an event adds to "usage" (stock consumed to make food and drinks).
export function usageDelta(e) {
  if (e.source === "auto_deduction" || e.reason !== "usage") return 0;
  return e.type === "out" ? e.quantity : -e.quantity;
}
