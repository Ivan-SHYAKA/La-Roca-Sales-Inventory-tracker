// How a bill was paid. Newer orders carry `payments` — a list of { method, amount } — so one
// bill can be part MoMo, part cash. Older orders only have a single paymentMethod/amountPaid;
// those are read as a one-item list so everything downstream treats them the same.
export const METHODS = {
  cash: "Cash",
  mobile_money: "MoMo",
  card: "Card",
};
export const methodLabel = (m) => METHODS[m] || (m === "split" ? "Split" : (m || "").replace("_", " "));

export function paymentsOf(order) {
  if (Array.isArray(order.payments) && order.payments.length) {
    return order.payments.map((p) => ({ method: p.method, amount: Number(p.amount) || 0 }));
  }
  if (order.paymentMethod && order.paymentMethod !== "split" && order.amountPaid != null) {
    return [{ method: order.paymentMethod, amount: Number(order.amountPaid) || 0 }];
  }
  return [];
}

// Adds up the payments of several orders (one bill) per method.
export function sumPayments(orders) {
  const by = {};
  orders.forEach((o) => paymentsOf(o).forEach((p) => { by[p.method] = (by[p.method] || 0) + p.amount; }));
  return Object.entries(by).map(([method, amount]) => ({ method, amount }));
}

// "Cash RWF 5,000 + MoMo RWF 10,000"
export function paymentText(payments, fmt) {
  return payments.map((p) => `${methodLabel(p.method)} RWF ${fmt(p.amount)}`).join(" + ");
}

// Shares each method's amount across a bill's orders in proportion to their totals, so every
// order carries its own payments and per-order accounting still adds up. The last order
// absorbs any rounding remainder.
export function splitPaymentsAcrossOrders(payments, orders) {
  const total = orders.reduce((s, o) => s + o.total, 0) || 1;
  const perOrder = orders.map(() => []);
  payments.forEach((p) => {
    let remaining = p.amount;
    orders.forEach((o, i) => {
      const share = i === orders.length - 1 ? remaining : Math.round((o.total / total) * p.amount);
      remaining -= share;
      if (share > 0) perOrder[i].push({ method: p.method, amount: share });
    });
  });
  return perOrder;
}
