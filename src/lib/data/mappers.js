// ---------- ROW <-> UI SHAPE MAPPERS ----------
// Keeps the original prototype's camelCase object shapes (order.items, m.recipe, etc.)
// so the screen components below barely change from la_roca_system.jsx.

export function mapProfile(p) {
  return { id: p.id, username: p.username, name: p.name, role: p.role, active: p.active };
}
export function mapOrder(row) {
  return {
    id: row.id,
    client: row.client_name,
    tableNumber: row.table_number || "",
    phone: row.phone || "",
    line: row.line,
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
  };
}

export function check(error) {
  if (error) throw new Error(error.message);
}
