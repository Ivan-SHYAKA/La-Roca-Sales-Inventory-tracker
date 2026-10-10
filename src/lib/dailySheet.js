// Logic behind the storekeeper's Daily Sheet — the screen that mirrors the Excel sheet
// (Item | Units | Opening | In | Out | Closing | Missing | Spoiled | Justification).
// Kept free of React so the rules can be tested on their own.
import { dailyItemLedger } from "./business";

// Headings in the order they appear on the storekeeper's Excel sheet.
export const CATEGORY_ORDER = [
  "Coffee & Tea", "Beverages / Drinks", "Bakery", "Snacks", "Foods", "Ingredients / Seasoning / Add-ons",
  "Vegetables", "Fruits", "Non-food Items", "Cleaning Items", "Staff Food", "Daily Snacks Production",
];
export const NO_CATEGORY = "Other items";
export const UNITS = ["Kg", "Ltr", "Btl", "Pc", "Bunch"];

export function categoryRank(cat) {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

const EPS = 1e-9;
const num = (v) => {
  if (v === "" || v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const round = (n) => Math.round(n * 1000) / 1000;

// One row per inventory item for the chosen day, grouped under the sheet headings.
export function buildSheet(inventory, stockEvents, date) {
  const ledger = dailyItemLedger(inventory, stockEvents, date);
  const start = new Date(new Date(date).getFullYear(), new Date(date).getMonth(), new Date(date).getDate()).getTime();
  const notes = {};
  stockEvents
    .filter((e) => e.source !== "auto_deduction" && e.note && new Date(e.date).getTime() >= start && new Date(e.date).getTime() < start + 86400000)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((e) => { (notes[e.invId] ||= []); if (!notes[e.invId].includes(e.note)) notes[e.invId].push(e.note); });
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));
  const rows = ledger.map((l) => ({
    id: l.id, name: l.name, unit: l.unit, category: l.category || NO_CATEGORY, line: invMap[l.id]?.line,
    reorderLevel: l.reorderLevel, quantityNow: invMap[l.id]?.quantity ?? 0,
    opening: round(l.opening), in: round(l.in), out: round(l.out),
    missing: round(l.outByReason.missing), spoiled: round(l.outByReason.spoilage),
    byReason: l.outByReason,
    note: (notes[l.id] || []).join("; "),
  }));
  const groups = {};
  rows.forEach((r) => (groups[r.category] ||= []).push(r));
  return Object.entries(groups)
    .map(([category, items]) => [category, items.sort((a, b) => a.name.localeCompare(b.name))])
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]));
}

// What the storekeeper has typed for a row (strings) -> the row's figures and any problem.
// `edit` holds only the cells they touched; the rest keep the recorded value.
export function evaluateRow(row, edit) {
  const cell = (k) => (edit && edit[k] !== undefined ? edit[k] : null);
  const val = (k) => { const c = cell(k); return c === null ? row[k] : num(c); };
  const t = { in: val("in"), out: val("out"), missing: val("missing"), spoiled: val("spoiled") };
  const note = edit && edit.note !== undefined ? edit.note.trim() : row.note;
  const changed = ["in", "out", "missing", "spoiled"].some((k) => Math.abs(t[k] - row[k]) > EPS);
  const noteChanged = edit && edit.note !== undefined && edit.note.trim() !== row.note;
  const closing = round(row.opening + t.in - t.out);
  let problem = null;
  if (Object.values(t).some((n) => !Number.isFinite(n) || n < 0)) problem = "Use numbers of 0 or more.";
  else if (t.missing + t.spoiled > t.out + EPS) problem = "Missing and Spoiled are part of Out, so together they can't be more than Out.";
  else if (closing < -EPS) problem = `Out is more than what was in store (${round(row.opening + t.in)} ${row.unit}).`;
  else if (changed && (t.missing > row.missing + EPS || t.spoiled > row.spoiled + EPS) && !note) problem = "Please say why in Justification.";
  else if (noteChanged && !changed) problem = "A justification is saved together with a change to a quantity.";
  return { ...t, closing, note, changed, problem };
}

// The stock entries that turn what's recorded into what the sheet now says. Only
// differences are written: more stock in/out is a normal entry; less is an opposite entry
// under the same reason (see stockMath.js). Stock-ins come first so a day's receipts
// are on the shelf before that day's usage is taken off it.
export function eventsForRow(row, ev, whenIso) {
  const out = [];
  const push = (reason, delta, forIn) => {
    if (Math.abs(delta) < EPS) return;
    // forIn: positive delta is stock coming in (restock). Otherwise positive delta is stock going out.
    const type = forIn ? (delta > 0 ? "in" : "out") : (delta > 0 ? "out" : "in");
    out.push({ invId: row.id, type, reason, quantity: round(Math.abs(delta)), date: whenIso, note: ev.note || null });
  };
  push("restock", ev.in - row.in, true);
  push("missing", ev.missing - row.missing, false);
  push("spoilage", ev.spoiled - row.spoiled, false);
  // Everything else that left the store (cooked, sold, given out). New amounts are "usage";
  // if it has to come down, take it back from usage first, then waste, then other.
  let dPlain = (ev.out - ev.missing - ev.spoiled) - (row.out - row.missing - row.spoiled);
  if (dPlain > EPS) push("usage", dPlain, false);
  else if (dPlain < -EPS) {
    let left = -dPlain;
    for (const reason of ["usage", "waste", "other"]) {
      const have = Math.max(0, row.byReason[reason] || 0);
      const take = Math.min(left, have);
      if (take > EPS) { push(reason, -take, false); left -= take; }
    }
  }
  return out;
}

export function sortInFirst(events) {
  return [...events.filter((e) => e.type === "in"), ...events.filter((e) => e.type === "out")];
}

// When an entry for the chosen day is stamped: right now for today, otherwise late that
// evening, so a sheet filled in the next morning still lands on the right day.
export function stampFor(dateStr, now = new Date()) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const sameDay = now.getFullYear() === y && now.getMonth() + 1 === m && now.getDate() === d;
  return (sameDay ? now : new Date(y, m - 1, d, 23, 0, 0)).toISOString();
}
