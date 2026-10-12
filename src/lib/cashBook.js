// The cash book: money in the till and on the MoMo line, day by day.
//
// Opening is what the manager enters at the start of a day (the very first one is the money
// held before the system was introduced). A day with no opening entered carries on from the
// day before: its counted closing if one was entered, otherwise what the system expected.
// What the system expects for a day = opening + that day's billed payments, per method.
import { paymentsOf } from "./payments";

const pad = (n) => String(n).padStart(2, "0");
export const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return dayStr(new Date(y, m - 1, d + n));
};

// day -> { cash, mobile_money, card } received from bills billed that day.
export function receiptsByDay(orders) {
  const by = {};
  orders.forEach((o) => {
    if (o.status !== "billed" || !o.billedAt) return;
    const k = dayStr(new Date(o.billedAt));
    const day = (by[k] ||= { cash: 0, mobile_money: 0, card: 0 });
    paymentsOf(o).forEach((p) => { day[p.method] = (day[p.method] || 0) + p.amount; });
  });
  return by;
}

// One row per day from the first day with an entry up to `upTo`.
export function buildCashBook(orders, entries, upTo) {
  const entryBy = Object.fromEntries(entries.map((e) => [e.day, e]));
  const days = entries.map((e) => e.day).sort();
  if (days.length === 0) return [];
  const receipts = receiptsByDay(orders);
  const rows = [];
  let carryCash = null;
  let carryMomo = null;
  const end = upTo > days[days.length - 1] ? upTo : days[days.length - 1];
  for (let d = days[0]; d <= end; d = addDays(d, 1)) {
    const e = entryBy[d];
    const r = receipts[d] || { cash: 0, mobile_money: 0, card: 0 };
    const openingCash = e?.openingCash ?? carryCash ?? 0;
    const openingMomo = e?.openingMomo ?? carryMomo ?? 0;
    const expectedCash = openingCash + r.cash;
    const expectedMomo = openingMomo + r.mobile_money;
    const countedCash = e?.closingCash ?? null;
    const countedMomo = e?.closingMomo ?? null;
    rows.push({
      day: d,
      openingCash, openingMomo,
      openingEntered: e?.openingCash != null || e?.openingMomo != null,
      cashIn: r.cash, momoIn: r.mobile_money, cardIn: r.card,
      expectedCash, expectedMomo,
      countedCash, countedMomo,
      diffCash: countedCash == null ? null : countedCash - expectedCash,
      diffMomo: countedMomo == null ? null : countedMomo - expectedMomo,
      note: e?.note || "",
    });
    carryCash = countedCash ?? expectedCash;
    carryMomo = countedMomo ?? expectedMomo;
  }
  return rows;
}
