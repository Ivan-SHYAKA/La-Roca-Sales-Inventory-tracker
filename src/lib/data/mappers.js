// ---------- ROW <-> UI SHAPE MAPPERS ----------
// Keeps the original prototype's camelCase object shapes (order.items, m.recipe, etc.)
// so the screen components below barely change from la_roca_system.jsx.

export function mapProfile(p) {
  return { id: p.id, username: p.username, name: p.name, role: p.role, active: p.active, signupPending: !!p.signup_pending, activitySeenAt: p.activity_seen_at || null };
}
export function mapAudit(r) {
  return {
    id: r.id,
    at: r.created_at,
    actorId: r.actor_id,
    actorName: r.actor_name || "System",
    actorRole: r.actor_role,
    category: r.category,
    action: r.action,
    summary: r.summary,
    details: r.details || {},
  };
}
export function mapOrder(row) {
  return {
    id: row.id,
    client: row.client_name,
    tableNumber: row.table_number || "",
    phone: row.phone || "",
    line: row.line,
    groupId: row.group_id || null,
    isStaffOrder: row.is_staff_order || false,
    status: row.status,
    total: Number(row.total) || 0,
    placedAt: row.placed_at,
    placedBy: row.placed_by_name || "",
    placedById: row.placed_by,
    readyAt: row.ready_at,
    readyBy: row.ready_by_name || "",
    readyById: row.ready_by,
    servedAt: row.served_at,
    servedBy: row.served_by_name || "",
    servedById: row.served_by,
    billedAt: row.billed_at,
    billedBy: row.billed_by_name || "",
    billedById: row.billed_by,
    paymentMethod: row.payment_method,
    amountPaid: row.amount_paid == null ? null : Number(row.amount_paid),
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by_name || "",
    cancelledById: row.cancelled_by,
    cancelReason: row.cancel_reason,
    guestDetails: row.guest_details,
    items: (row.order_items || []).map((it) => ({
      menuId: it.menu_item_id,
      name: it.name,
      price: Number(it.unit_price) || 0,
      prepMinutes: Number(it.prep_minutes) || 0,
      qty: Number(it.qty) || 0,
    })),
  };
}
export function mapMenuItem(row) {
  return {
    id: row.id,
    name: row.name,
    line: row.line,
    price: Number(row.price) || 0,
    prepMinutes: Number(row.prep_minutes) || 0,
    active: row.active !== false,
    recipe: (row.recipe_ingredients || []).map((r) => ({ invId: r.inventory_id, qty: Number(r.qty_per_unit) || 0 })),
  };
}
export function mapInventory(row) {
  return {
    id: row.id,
    name: row.name,
    line: row.line,
    category: row.category || "",
    unit: row.unit,
    quantity: Number(row.quantity) || 0,
    reorderLevel: Number(row.reorder_level) || 0,
    costPerUnit: Number(row.cost_per_unit) || 0,
  };
}
export function mapStockEvent(row) {
  return {
    id: row.id,
    invId: row.inventory_id,
    type: row.type,
    reason: row.reason,
    quantity: Number(row.quantity) || 0,
    date: row.date,
    user: row.user_name || "",
    userId: row.user_id,
    note: row.note || "",
    orderId: row.order_id || null,
    source: row.source || "manual",
  };
}

// Groups the flat rows from the storekeeper_order_items() RPC (one row per order
// item) back into an order-like shape — the same {id, line, status, items} shape
// `dailyStockReport`/`computeStorekeeperAlerts` already expect, just missing every
// field that function deliberately doesn't expose (client, phone, payment, etc).
export function mapStorekeeperOrders(rows) {
  const byOrder = {};
  (rows || []).forEach((r) => {
    const o = (byOrder[r.order_id] ||= {
      id: r.order_id,
      tableNumber: r.table_number || "",
      line: r.line,
      status: r.status,
      servedAt: r.served_at,
      placedAt: r.placed_at,
      placedBy: r.placed_by_name || "",
      groupId: r.group_id || null,
      items: [],
    });
    o.items.push({ menuId: r.menu_item_id, name: r.item_name, qty: Number(r.qty) || 0 });
  });
  return Object.values(byOrder);
}

export function mapStockAlert(row) {
  return {
    id: row.id,
    invId: row.inventory_id,
    orderId: row.order_id,
    menuId: row.menu_item_id,
    message: row.message,
    severity: row.severity,
    resolved: row.resolved,
    createdAt: row.created_at,
  };
}

export function mapFixedCost(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    amount: Number(row.amount) || 0,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
    note: row.note || "",
    createdBy: row.created_by_name || "",
    createdAt: row.created_at,
  };
}
export function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    severity: row.severity,
    targetRole: row.target_role,
    orderId: row.order_id,
    inventoryId: row.inventory_id,
    createdAt: row.created_at,
  };
}

// Preserves the Postgres error code (e.g. from a trigger's RAISE EXCEPTION) on the thrown
// Error — callers that only read `.message` are unaffected, but this lets a caller branch
// on `.code` when it needs to tell one DB-side rejection apart from another.
export function check(error) {
  if (error) {
    const e = new Error(error.message);
    e.code = error.code;
    throw e;
  }
}
