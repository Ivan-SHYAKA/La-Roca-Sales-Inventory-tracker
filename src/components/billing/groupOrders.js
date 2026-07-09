const STATUS_ORDER = ["placed", "ready", "served", "billed"];

// A waiter's cart can span multiple lines now (a burger + a cappuccino), which under the
// hood becomes one order per line so kitchen/barista routing stays simple — but the guest
// still thinks of it as one table's bill. This regroups those sibling orders back into a
// single row for billing so sales only ever takes one payment and prints one receipt per
// table, not one per department. Orders without a table number (older data, or bookings
// identified by client name only) are left as their own single-order "group".
//
// Billed/cancelled orders are grouped by table + close billed/cancelled timestamps (same
// minute) rather than by table alone, since a table number gets reused across separate
// sittings — grouping strictly by table forever would merge unrelated past visits.
export function groupOrders(orders) {
  const used = new Set();
  const groups = [];
  orders.forEach((o) => {
    if (used.has(o.id)) return;
    let siblings;
    if (!o.tableNumber) {
      siblings = [o];
    } else if (o.status === "billed" || o.status === "cancelled") {
      const ts = new Date(o.billedAt || o.cancelledAt || o.placedAt).getTime();
      siblings = orders.filter((x) =>
        !used.has(x.id) && x.tableNumber === o.tableNumber &&
        (x.status === "billed" || x.status === "cancelled") &&
        Math.abs(new Date(x.billedAt || x.cancelledAt || x.placedAt).getTime() - ts) < 60000
      );
    } else {
      siblings = orders.filter((x) =>
        !used.has(x.id) && x.tableNumber === o.tableNumber &&
        x.status !== "billed" && x.status !== "cancelled"
      );
    }
    siblings.forEach((s) => used.add(s.id));
    groups.push(siblings);
  });
  return groups;
}

export function summarize(group) {
  const first = group[0];
  const active = group.filter((o) => o.status !== "cancelled");
  const lines = [...new Set(group.map((o) => o.line))];
  const items = group.flatMap((o) => o.items.map((it) => ({ ...it, line: o.line })));
  const total = group.reduce((s, o) => s + o.total, 0);
  const status = active.length === 0
    ? "cancelled"
    : active.reduce((min, o) => STATUS_ORDER.indexOf(o.status) < STATUS_ORDER.indexOf(min) ? o.status : min, "billed");
  const servedDates = group.map((o) => o.servedAt).filter(Boolean).sort();
  const billedDates = group.map((o) => o.billedAt).filter(Boolean).sort();
  return {
    key: group.map((o) => o.id).sort().join("-"),
    orders: group,
    activeOrders: active,
    tableNumber: first.tableNumber,
    client: first.client,
    phone: group.find((o) => o.phone)?.phone,
    placedBy: first.placedBy,
    placedAt: group.map((o) => o.placedAt).sort()[0],
    servedAt: servedDates[servedDates.length - 1],
    billedAt: billedDates[billedDates.length - 1],
    line: lines[0],
    lines,
    items,
    total,
    status,
    canPay: active.length > 0 && active.every((o) => o.status === "served"),
    canCancel: active.some((o) => o.status === "placed" || o.status === "ready" || o.status === "served"),
    isBilled: active.length > 0 && active.every((o) => o.status === "billed"),
  };
}

// Splits a combined "amount received" across the sibling orders proportionally to each
// one's own total, so per-order accounting (amount_paid) still adds up to what was
// actually taken — the last order absorbs any rounding remainder.
export function distributeAmount(amount, orders) {
  const total = orders.reduce((s, o) => s + o.total, 0) || 1;
  let remaining = amount;
  return orders.map((o, i) => {
    if (i === orders.length - 1) return remaining;
    const share = Math.round((o.total / total) * amount);
    remaining -= share;
    return share;
  });
}
