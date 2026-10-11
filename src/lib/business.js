import { DEPT_CAPACITY, DEPT_FOR_LINE } from "./constants";
import { mins, orderLabel, humanizeDuration } from "./format";
import { usageDelta } from "./stockMath";

// ---------- ORDER LOGIC (unchanged from the prototype) ----------
export function orderPrepMinutes(order) {
  return order.items.reduce((s, it) => s + it.prepMinutes * it.qty, 0);
}
// ETA for an order waiting in a specific department's queue (kitchen or barista — reception check-in has no timed queue).
export function estimateServeMinutes(order, orders) {
  const dept = DEPT_FOR_LINE[order.line];
  if (dept !== "kitchen" && dept !== "barista") return 0;
  const ahead = orders.filter((o) => o.id !== order.id && DEPT_FOR_LINE[o.line] === dept && o.status === "placed" && o.placedAt <= order.placedAt);
  const aheadPrep = ahead.reduce((s, o) => s + orderPrepMinutes(o), 0);
  return Math.round(aheadPrep / DEPT_CAPACITY[dept] + orderPrepMinutes(order));
}
// A table's order can be split across lines (a burger from the kitchen, a cappuccino from
// the barista) even though the waiter thinks of it as one ticket — so this groups them back
// by groupId (set at placement) for display, falling back to table number alone for orders
// placed before that column existed.
export function groupOrdersByGroupId(orders) {
  const used = new Set();
  const groups = [];
  orders.forEach((o) => {
    if (used.has(o.id)) return;
    const siblings = o.groupId
      ? orders.filter((x) => !used.has(x.id) && x.groupId === o.groupId)
      : o.tableNumber
        ? orders.filter((x) => !used.has(x.id) && !x.groupId && x.tableNumber === o.tableNumber)
        : [o];
    siblings.forEach((s) => used.add(s.id));
    groups.push(siblings);
  });
  return groups;
}

export function computeFlags(orders) {
  const t = Date.now();
  const flags = [];
  orders.forEach((o) => {
    if (o.status === "placed") {
      const dept = DEPT_FOR_LINE[o.line];
      if (dept === "kitchen" || dept === "barista") {
        const eta = estimateServeMinutes(o, orders);
        const elapsed = mins(t - new Date(o.placedAt).getTime());
        if (elapsed > eta + 15) flags.push({ id: o.id + "-late", role: dept, severity: elapsed > eta + 30 ? "high" : "medium", msg: `${orderLabel(o)}'s order is ${humanizeDuration((elapsed - eta) * 60000)} past its estimated ${dept} time.` });
      }
    }
    if (o.status === "ready") {
      const elapsed = mins(t - new Date(o.readyAt).getTime());
      if (elapsed > 10) flags.push({ id: o.id + "-unserved", role: "waiter", severity: elapsed > 20 ? "high" : "medium", msg: `${orderLabel(o)}'s order has been ready ${humanizeDuration(elapsed * 60000)} but hasn't been served yet.` });
    }
    if (o.status === "served") {
      const elapsed = mins(t - new Date(o.servedAt).getTime());
      if (elapsed > 20) flags.push({ id: o.id + "-unbilled", role: "sales", severity: elapsed > 45 ? "high" : "medium", msg: `Order for ${orderLabel(o)} was served ${humanizeDuration(elapsed * 60000)} ago but hasn't been billed.` });
    }
  });
  return flags;
}

// ---------- DAY-SCOPED STOCK REPORT (recorded vs. order-driven estimate) ----------
function dayBounds(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return [start, start + 86400000];
}

// The storekeeper's own report for one calendar day, built purely from stock_events —
// deliberately excludes source='auto_deduction' events (0009's order-time auto-deduct)
// so this stays a pure record of what a human actually logged, independent of what the
// system separately auto-tracks. See autoDeductedUsageForDay for that other side.
export function dailyItemLedger(inventory, stockEvents, date) {
  const [dayStart, dayEnd] = dayBounds(date);
  const manualEvents = stockEvents.filter((e) => e.source !== "auto_deduction");
  return inventory.map((inv) => {
    const events = manualEvents.filter((e) => e.invId === inv.id);
    const before = events.filter((e) => new Date(e.date).getTime() < dayStart);
    const openingBase = before.reduce((s, e) => s + (e.type === "in" ? e.quantity : -e.quantity), 0);
    const today = events.filter((e) => { const t = new Date(e.date).getTime(); return t >= dayStart && t < dayEnd; });
    // Net per reason: a correction (see stockMath.js) is an opposite entry under the same reason.
    // A stock count correction ("adjustment") re-bases the day's Opening instead of being
    // counted as stock in or out, so it never reads as consumption or as a shortfall.
    let inQty = 0;
    let adjusted = 0;
    const outByReason = { usage: 0, waste: 0, spoilage: 0, missing: 0, other: 0 };
    today.forEach((e) => {
      const sign = e.type === "in" ? 1 : -1;
      if (e.reason === "adjustment") adjusted += sign * e.quantity;
      else if (e.reason === "restock") inQty += sign * e.quantity;
      else outByReason[e.reason] = (outByReason[e.reason] || 0) - sign * e.quantity;
    });
    const opening = Math.max(0, openingBase + adjusted);
    const outQty = Object.values(outByReason).reduce((s, v) => s + v, 0);
    return { id: inv.id, name: inv.name, unit: inv.unit, category: inv.category, reorderLevel: inv.reorderLevel, opening, in: inQty, out: outQty, outByReason, closing: Math.max(0, opening + inQty - outQty) };
  });
}

// The system's own calculation for that same day: recipe-expected usage from served/billed orders.
export function expectedUsageForDay(inventory, orders, menu, date) {
  const [dayStart, dayEnd] = dayBounds(date);
  const dayOrders = orders.filter((o) => ["served", "billed"].includes(o.status) && o.servedAt && new Date(o.servedAt).getTime() >= dayStart && new Date(o.servedAt).getTime() < dayEnd);
  const expected = {};
  dayOrders.forEach((o) => o.items.forEach((it) => {
    const m = menu.find((mm) => mm.id === it.menuId);
    (m?.recipe || []).forEach((r) => { expected[r.invId] = (expected[r.invId] || 0) + r.qty * it.qty; });
  }));
  return Object.fromEntries(inventory.map((inv) => [inv.id, expected[inv.id] || 0]));
}

// Merges the two: what the storekeeper recorded vs. what the day's orders imply should've
// been used, flagged when they diverge — the "separate report... side by side" comparison.
export function dailyStockReport(inventory, orders, menu, stockEvents, date) {
  const ledger = dailyItemLedger(inventory, stockEvents, date);
  const expectedMap = expectedUsageForDay(inventory, orders, menu, date);
  return ledger
    .map((l) => {
      const expectedOut = expectedMap[l.id] || 0;
      const reportedOut = l.outByReason.usage;
      const variance = reportedOut - expectedOut;
      const flagged = expectedOut > 0 && Math.abs(variance) > Math.max(0.15 * expectedOut, l.reorderLevel * 0.2 || 1);
      return { ...l, missing: l.outByReason.missing, spoiled: l.outByReason.spoilage, expectedOut, variance, flagged };
    })
    .filter((r) => r.expectedOut > 0 || r.in > 0 || r.out > 0);
}

// ---------- ORDER -> STOREKEEPER INGREDIENT ALERTS ----------
export function ingredientsNeededForOrder(order, menu, inventory) {
  const needed = {};
  order.items.forEach((it) => {
    const m = menu.find((mm) => mm.id === it.menuId);
    (m?.recipe || []).forEach((r) => { needed[r.invId] = (needed[r.invId] || 0) + r.qty * it.qty; });
  });
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));
  return Object.entries(needed).map(([invId, qty]) => ({ invId, name: invMap[invId]?.name || "—", unit: invMap[invId]?.unit || "", qty }));
}

// One flag per currently-placed order that has recipe-linked ingredients, so the
// storekeeper sees what's needed as soon as it's ordered (naturally clears once the
// order moves past "placed", same lifecycle as the other computeFlags entries).
export function computeStorekeeperAlerts(orders, menu, inventory) {
  return orders
    .filter((o) => o.status === "placed")
    .map((o) => ({ order: o, ingredients: ingredientsNeededForOrder(o, menu, inventory) }))
    .filter((x) => x.ingredients.length > 0)
    .map((x) => ({
      id: x.order.id + "-ingredients",
      role: "storekeeper",
      severity: "medium",
      msg: `${orderLabel(x.order)}'s order needs: ${x.ingredients.map((i) => `${i.qty} ${i.unit} ${i.name}`).join(", ")}.`,
    }));
}

// The storekeeper's persistent, by-date reference log — unlike computeStorekeeperAlerts
// (which only shows currently-"placed" orders, so it clears the moment an order moves on),
// this covers every order placed on the given day regardless of its current status, so it
// can be looked back on for reconciliation after the fact. Grouped by groupId so a table's
// mixed restaurant+coffee-shop cart shows as the single order the waiter placed, not once
// per line — matching how waiters already see their own orders.
export function ordersForStorekeeperLog(orders, menu, inventory, date) {
  const [dayStart, dayEnd] = dayBounds(date);
  const dayOrders = orders.filter((o) => {
    const t = new Date(o.placedAt).getTime();
    return t >= dayStart && t < dayEnd;
  });
  return groupOrdersByGroupId(dayOrders)
    .map((g) => {
      const ingredients = {};
      g.forEach((o) => ingredientsNeededForOrder(o, menu, inventory).forEach((i) => {
        const cur = ingredients[i.invId];
        ingredients[i.invId] = { ...i, qty: (cur?.qty || 0) + i.qty };
      }));
      const sorted = [...g].sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
      return {
        key: g.map((o) => o.id).sort().join("-"),
        orders: g,
        placedAt: sorted[0].placedAt,
        placedBy: [...new Set(g.map((o) => o.placedBy).filter(Boolean))].join(", "),
        label: orderLabel(sorted[0]),
        lines: g.map((o) => ({ line: o.line, status: o.status })),
        ingredients: Object.values(ingredients).sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .filter((g) => g.ingredients.length > 0)
    .sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
}

// ---------- PERIOD-SCOPED BUSINESS HEALTH (dashboard: revenue, cost, profit/loss) ----------
function rangeBounds(startDate, endDate) {
  const s = new Date(startDate);
  const start = new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime();
  const e = new Date(endDate);
  const end = new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime() + 86400000;
  return [start, end];
}
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Every calendar day in [startDate, endDate], inclusive on both ends.
function daysInRange(startDate, endDate) {
  const [start, end] = rangeBounds(startDate, endDate);
  const out = [];
  for (let t = start; t < end; t += 86400000) out.push(toDateStr(new Date(t)));
  return out;
}

// Revenue actually billed in the period. Staff personal orders are included in the total
// (real cash the business took in) but broken out separately so the owner can see how much
// of it was staff meals at a reduced price rather than full-paying guests.
export function revenueForPeriod(orders, startDate, endDate) {
  const [start, end] = rangeBounds(startDate, endDate);
  const billed = orders.filter((o) => o.status === "billed" && o.billedAt && new Date(o.billedAt).getTime() >= start && new Date(o.billedAt).getTime() < end);
  const staffOrders = billed.filter((o) => o.isStaffOrder);
  const guestOrders = billed.filter((o) => !o.isStaffOrder);
  const lines = ["restaurant", "coffeeshop", "accommodations"];
  const revenueByLine = lines.map((line) => ({ line, total: billed.filter((o) => o.line === line).reduce((s, o) => s + o.total, 0) }));
  const byDay = daysInRange(startDate, endDate).map((date) => {
    const [dStart, dEnd] = rangeBounds(date, date);
    const total = billed.filter((o) => { const t = new Date(o.billedAt).getTime(); return t >= dStart && t < dEnd; }).reduce((s, o) => s + o.total, 0);
    return { date, total };
  });
  return {
    total: billed.reduce((s, o) => s + o.total, 0),
    byLine: revenueByLine,
    staffOrders: { count: staffOrders.length, total: staffOrders.reduce((s, o) => s + o.total, 0) },
    guestTotal: guestOrders.reduce((s, o) => s + o.total, 0),
    byDay,
  };
}

// What storekeepers actually recorded as "usage" stock-out, priced at each item's cost —
// this is the period's real cost of ingredients, as far as anyone has recorded it.
export function recordedCostForPeriod(inventory, stockEvents, startDate, endDate) {
  const [start, end] = rangeBounds(startDate, endDate);
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));
  const events = stockEvents.filter((e) => { const t = new Date(e.date).getTime(); return t >= start && t < end; });
  return events.reduce((s, e) => s + usageDelta(e) * (invMap[e.invId]?.costPerUnit || 0), 0);
}

// The system's own estimate of ingredient cost, straight from recipes x served/billed
// orders in the period — the "system calculated" half of the storekeeper-vs-system compare.
export function expectedCostForPeriod(inventory, orders, menu, startDate, endDate) {
  const [start, end] = rangeBounds(startDate, endDate);
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));
  const periodOrders = orders.filter((o) => ["served", "billed"].includes(o.status) && o.servedAt && (() => { const t = new Date(o.servedAt).getTime(); return t >= start && t < end; })());
  let cost = 0;
  periodOrders.forEach((o) => o.items.forEach((it) => {
    const m = menu.find((mm) => mm.id === it.menuId);
    (m?.recipe || []).forEach((r) => { cost += r.qty * it.qty * (invMap[r.invId]?.costPerUnit || 0); });
  }));
  return cost;
}

// Fixed costs (salaries, utilities, rent, ...) active during the period. 'monthly' costs
// count once for every calendar month they overlap -- simple on purpose, not day-prorated.
export function fixedCostsForPeriod(fixedCosts, startDate, endDate) {
  const [start, end] = rangeBounds(startDate, endDate);
  let total = 0;
  const byCategory = {};
  fixedCosts.forEach((c) => {
    const costStart = new Date(c.startDate).getTime();
    const costEnd = c.endDate ? new Date(c.endDate).getTime() + 86400000 : Infinity;
    if (costEnd <= start || costStart >= end) return; // no overlap with the period at all
    let occurrences = 1;
    if (c.frequency === "monthly") {
      const overlapStart = new Date(Math.max(costStart, start));
      const overlapEnd = new Date(Math.min(costEnd, end) - 1);
      occurrences = (overlapEnd.getFullYear() - overlapStart.getFullYear()) * 12 + (overlapEnd.getMonth() - overlapStart.getMonth()) + 1;
    }
    const amount = c.amount * occurrences;
    total += amount;
    byCategory[c.category] = (byCategory[c.category] || 0) + amount;
  });
  return { total, byCategory };
}

// The whole picture in one place: revenue in, cost of ingredients actually used out, fixed
// costs out, what's left over. Deliberately plain -- no separate "gross" vs "net" jargon.
export function profitLossForPeriod(inventory, orders, menu, stockEvents, fixedCosts, startDate, endDate) {
  const revenue = revenueForPeriod(orders, startDate, endDate);
  const recordedCost = recordedCostForPeriod(inventory, stockEvents, startDate, endDate);
  const expectedCost = expectedCostForPeriod(inventory, orders, menu, startDate, endDate);
  const fixed = fixedCostsForPeriod(fixedCosts, startDate, endDate);
  const profit = revenue.total - recordedCost - fixed.total;
  return { revenue, recordedCost, expectedCost, fixed, profit };
}

export function reconciliation(inventory, orders, menu, stockEvents, days) {
  const since = Date.now() - days * 86400000;
  const servedOrders = orders.filter((o) => ["served", "billed"].includes(o.status) && new Date(o.servedAt).getTime() >= since);
  return inventory.map((inv) => {
    let expected = 0;
    servedOrders.forEach((o) => {
      o.items.forEach((it) => {
        const m = menu.find((mm) => mm.id === it.menuId);
        if (!m) return;
        const rec = (m.recipe || []).find((r) => r.invId === inv.id);
        if (rec) expected += rec.qty * it.qty;
      });
    });
    const usageEvents = stockEvents.filter((e) => e.invId === inv.id && usageDelta(e) !== 0 && new Date(e.date).getTime() >= since);
    const actual = usageEvents.reduce((s, e) => s + usageDelta(e), 0);
    const loggedBy = [...new Set(usageEvents.map((e) => e.user))];
    const variance = actual - expected;
    const flagged = expected > 0 && Math.abs(variance) > Math.max(0.15 * expected, inv.reorderLevel * 0.2 || 1);
    return { name: inv.name, unit: inv.unit, expected, actual, variance, flagged, loggedBy };
  }).filter((r) => r.expected > 0 || r.actual > 0);
}
