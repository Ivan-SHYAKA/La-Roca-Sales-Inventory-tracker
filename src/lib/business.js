import { DEPT_CAPACITY, DEPT_FOR_LINE } from "./constants";
import { mins, orderLabel } from "./format";

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
export function computeFlags(orders) {
  const t = Date.now();
  const flags = [];
  orders.forEach((o) => {
    if (o.status === "placed") {
      const dept = DEPT_FOR_LINE[o.line];
      if (dept === "kitchen" || dept === "barista") {
        const eta = estimateServeMinutes(o, orders);
        const elapsed = mins(t - new Date(o.placedAt).getTime());
        if (elapsed > eta + 15) flags.push({ id: o.id + "-late", role: dept, severity: elapsed > eta + 30 ? "high" : "medium", msg: `${orderLabel(o)}'s order is ${elapsed - eta} min past its estimated ${dept} time.` });
      }
    }
    if (o.status === "ready") {
      const elapsed = mins(t - new Date(o.readyAt).getTime());
      if (elapsed > 10) flags.push({ id: o.id + "-unserved", role: "waiter", severity: elapsed > 20 ? "high" : "medium", msg: `${orderLabel(o)}'s order has been ready ${elapsed} min but hasn't been served yet.` });
    }
    if (o.status === "served") {
      const elapsed = mins(t - new Date(o.servedAt).getTime());
      if (elapsed > 20) flags.push({ id: o.id + "-unbilled", role: "sales", severity: elapsed > 45 ? "high" : "medium", msg: `Order for ${orderLabel(o)} was served ${elapsed} min ago but hasn't been billed.` });
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

// The storekeeper's own report for one calendar day, built purely from stock_events.
export function dailyItemLedger(inventory, stockEvents, date) {
  const [dayStart, dayEnd] = dayBounds(date);
  return inventory.map((inv) => {
    const events = stockEvents.filter((e) => e.invId === inv.id);
    const before = events.filter((e) => new Date(e.date).getTime() < dayStart);
    const opening = Math.max(0, before.reduce((s, e) => s + (e.type === "in" ? e.quantity : -e.quantity), 0));
    const today = events.filter((e) => { const t = new Date(e.date).getTime(); return t >= dayStart && t < dayEnd; });
    const inQty = today.filter((e) => e.type === "in").reduce((s, e) => s + e.quantity, 0);
    const outByReason = { usage: 0, waste: 0, spoilage: 0, missing: 0, other: 0 };
    today.filter((e) => e.type === "out").forEach((e) => { outByReason[e.reason] = (outByReason[e.reason] || 0) + e.quantity; });
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
    const usageEvents = stockEvents.filter((e) => e.invId === inv.id && e.type === "out" && e.reason === "usage" && new Date(e.date).getTime() >= since);
    const actual = usageEvents.reduce((s, e) => s + e.quantity, 0);
    const loggedBy = [...new Set(usageEvents.map((e) => e.user))];
    const variance = actual - expected;
    const flagged = expected > 0 && Math.abs(variance) > Math.max(0.15 * expected, inv.reorderLevel * 0.2 || 1);
    return { name: inv.name, unit: inv.unit, expected, actual, variance, flagged, loggedBy };
  }).filter((r) => r.expected > 0 || r.actual > 0);
}
