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
