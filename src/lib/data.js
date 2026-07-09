import { supabase } from "./supabaseClient";
import { now } from "./format";

// ---------- ROW <-> UI SHAPE MAPPERS ----------
// Keeps the original prototype's camelCase object shapes (order.items, m.recipe, etc.)
// so the screen components below barely change from la_roca_system.jsx.

function mapProfile(p) {
  return { id: p.id, username: p.username, name: p.name, role: p.role, active: p.active };
}
function mapOrder(row) {
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
function mapMenuItem(row) {
  return {
    id: row.id,
    name: row.name,
    line: row.line,
    price: Number(row.price) || 0,
    prepMinutes: Number(row.prep_minutes) || 0,
    recipe: (row.recipe_ingredients || []).map((r) => ({ invId: r.inventory_id, qty: Number(r.qty_per_unit) || 0 })),
  };
}
function mapInventory(row) {
  return {
    id: row.id,
    name: row.name,
    line: row.line,
    unit: row.unit,
    quantity: Number(row.quantity) || 0,
    reorderLevel: Number(row.reorder_level) || 0,
    costPerUnit: Number(row.cost_per_unit) || 0,
  };
}
function mapStockEvent(row) {
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
  };
}

function check(error) {
  if (error) throw new Error(error.message);
}

// ---------- FETCHES ----------
export async function fetchProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  check(error);
  return mapProfile(data);
}
export async function fetchProfiles() {
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
  check(error);
  return (data || []).map(mapProfile);
}
export async function fetchOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("placed_at", { ascending: false });
  check(error);
  return (data || []).map(mapOrder);
}
export async function fetchMenu() {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*, recipe_ingredients(*)")
    .order("created_at", { ascending: false });
  check(error);
  return (data || []).map(mapMenuItem);
}
export async function fetchInventory() {
  const { data, error } = await supabase.from("inventory").select("*").order("created_at", { ascending: false });
  check(error);
  return (data || []).map(mapInventory);
}
export async function fetchStockEvents() {
  const { data, error } = await supabase.from("stock_events").select("*").order("date", { ascending: false });
  check(error);
  return (data || []).map(mapStockEvent);
}

// ---------- ORDERS ----------
export async function placeOrder({ client, tableNumber, phone, line, cart, session }) {
  const total = cart.reduce((s, x) => s + x.price * x.qty, 0);
  // Generate the id client-side and skip `.select()` on the insert: waiters can
  // insert orders but have no SELECT policy on orders (insert-only, per spec), and
  // PostgREST's RETURNING (triggered by .select()) is itself gated by the SELECT
  // policy — chaining .select() here would make the whole insert fail for waiters.
  const orderId = crypto.randomUUID();
  const { error } = await supabase.from("orders").insert({
    id: orderId,
    client_name: client || null,
    table_number: tableNumber || null,
    phone: phone || null,
    line,
    status: "placed",
    total,
    placed_by: session.id,
    placed_by_name: session.name,
  });
  check(error);
  const { error: itemsError } = await supabase.from("order_items").insert(
    cart.map((x) => ({
      order_id: orderId,
      menu_item_id: x.menuId,
      name: x.name,
      qty: x.qty,
      unit_price: x.price,
      prep_minutes: x.prepMinutes,
    }))
  );
  check(itemsError);
}
export async function markOrderReady(orderId, session) {
  const { error } = await supabase
    .from("orders")
    .update({ status: "ready", ready_at: now(), ready_by: session.id, ready_by_name: session.name })
    .eq("id", orderId);
  check(error);
}
export async function serveOrder(orderId, session) {
  const { error } = await supabase
    .from("orders")
    .update({ status: "served", served_at: now(), served_by: session.id, served_by_name: session.name })
    .eq("id", orderId);
  check(error);
}
export async function billOrder(orderId, session, { paymentMethod, amountPaid }) {
  const { error } = await supabase
    .from("orders")
    .update({
      status: "billed",
      billed_at: now(),
      billed_by: session.id,
      billed_by_name: session.name,
      payment_method: paymentMethod,
      amount_paid: amountPaid,
    })
    .eq("id", orderId);
  check(error);
}
export async function cancelOrder(orderId, session, reason) {
  const { error } = await supabase
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: now(),
      cancelled_by: session.id,
      cancelled_by_name: session.name,
      cancel_reason: reason,
    })
    .eq("id", orderId);
  check(error);
}
export async function checkInOrder(order, session, guestDetails, amenities) {
  const { error } = await supabase
    .from("orders")
    .update({
      status: "served",
      served_at: now(),
      served_by: session.id,
      served_by_name: session.name,
      guest_details: guestDetails,
    })
    .eq("id", order.id);
  check(error);

  const events = amenities.filter((a) => a.qty > 0);
  if (events.length) {
    const { error: eventsError } = await supabase.from("stock_events").insert(
      events.map((a) => ({
        inventory_id: a.invId,
        type: "out",
        reason: "usage",
        quantity: a.qty,
        user_id: session.id,
        user_name: session.name,
        note: `Check-in amenities — ${order.client}`,
      }))
    );
    check(eventsError);
  }
}

// ---------- MENU ----------
export async function addMenuItem(form, recipe) {
  const { data: item, error } = await supabase
    .from("menu_items")
    .insert({
      name: form.name.trim(),
      line: form.line,
      price: Number(form.price) || 0,
      prep_minutes: Number(form.prepMinutes) || 5,
    })
    .select()
    .single();
  check(error);
  const rows = recipe.filter((r) => r.invId && r.qty);
  if (rows.length) {
    const { error: recipeError } = await supabase.from("recipe_ingredients").insert(
      rows.map((r) => ({ menu_item_id: item.id, inventory_id: r.invId, qty_per_unit: Number(r.qty) }))
    );
    check(recipeError);
  }
}
export async function updateMenuItem(id, form, recipe) {
  const { error } = await supabase
    .from("menu_items")
    .update({
      name: form.name.trim(),
      line: form.line,
      price: Number(form.price) || 0,
      prep_minutes: Number(form.prepMinutes) || 5,
    })
    .eq("id", id);
  check(error);
  // Simplest correct way to sync the recipe list: replace it wholesale rather than
  // diffing rows — recipes are short (a handful of ingredients), so this is cheap.
  const { error: deleteError } = await supabase.from("recipe_ingredients").delete().eq("menu_item_id", id);
  check(deleteError);
  const rows = recipe.filter((r) => r.invId && r.qty);
  if (rows.length) {
    const { error: recipeError } = await supabase.from("recipe_ingredients").insert(
      rows.map((r) => ({ menu_item_id: id, inventory_id: r.invId, qty_per_unit: Number(r.qty) }))
    );
    check(recipeError);
  }
}
export async function removeMenuItem(id) {
  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  check(error);
}

// ---------- INVENTORY / STOCK EVENTS ----------
// stock_events insert triggers a DB-side update of inventory.quantity (see migration),
// so this never has to read-modify-write the running total itself.
export async function logStockEvent({ mode, existingId, newItem, quantity, reason, note, session }) {
  let invId = existingId;
  if (!invId) {
    const { data: item, error } = await supabase
      .from("inventory")
      .insert({
        name: newItem.name.trim(),
        line: newItem.line,
        unit: newItem.unit,
        quantity: 0,
        reorder_level: Number(newItem.reorderLevel) || 0,
        cost_per_unit: Number(newItem.costPerUnit) || 0,
      })
      .select()
      .single();
    check(error);
    invId = item.id;
  }
  const { error: eventError } = await supabase.from("stock_events").insert({
    inventory_id: invId,
    type: mode,
    reason: mode === "in" ? "restock" : reason,
    quantity,
    user_id: session.id,
    user_name: session.name,
    note: note || null,
  });
  check(eventError);
}

// ---------- USERS ----------
export async function toggleUserActive(userId, active) {
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  check(error);
}

// ---------- REALTIME ----------
// Any change to a watched table triggers a full refetch of that screen's data.
// Simpler and less bug-prone than patching local state incrementally, and the
// data volumes here are small enough that refetching is cheap.
export function subscribeToChanges(tables, onChange) {
  const channel = supabase.channel(`lr-${tables.join("-")}-${Math.random().toString(36).slice(2)}`);
  tables.forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
  });
  channel.subscribe();
  return () => supabase.removeChannel(channel);
}
