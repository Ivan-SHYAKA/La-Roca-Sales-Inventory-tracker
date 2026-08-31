import { supabase } from "../supabaseClient";
import { now } from "../format";
import { mapOrder, mapStorekeeperOrders, check } from "./mappers";

export async function fetchOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("placed_at", { ascending: false });
  check(error);
  return (data || []).map(mapOrder);
}

// Restricted read path for storekeeper: only item/line/status/table-number/served-at,
// via the storekeeper_order_items() SECURITY DEFINER function — no client name, phone,
// payment, or check-in details. Returns [] for any other role (see migration 0007).
export async function fetchStorekeeperOrders() {
  const { data, error } = await supabase.rpc("storekeeper_order_items");
  check(error);
  return mapStorekeeperOrders(data);
}

// ---------- ORDERS ----------
export async function placeOrder({ client, tableNumber, phone, line, cart, session, groupId, isStaffOrder, staffTotal }) {
  const menuTotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
  // A staff personal order can be recorded at whatever reduced price the waiter/sales
  // enters (e.g. at cost) instead of the normal menu price -- staffTotal is that
  // per-line share, already split proportionally by the caller across mixed-line carts.
  const total = isStaffOrder && staffTotal != null ? staffTotal : menuTotal;
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
    group_id: groupId || null,
    is_staff_order: !!isStaffOrder,
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
  if (itemsError) {
    // The order row above already committed as a separate request, so if this insert
    // fails for any reason (network drop, RLS, etc.) it'd otherwise sit in every queue
    // as a real, itemless "placed" order. Best-effort: if this cleanup itself fails,
    // still surface the original error rather than the cleanup's.
    await supabase.rpc("delete_empty_order", { p_order_id: orderId }).catch(() => {});
    check(itemsError);
  }
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
