import { supabase } from "../supabaseClient";
import { mapInventory, mapStockEvent, check } from "./mappers";

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

// ---------- INVENTORY / STOCK EVENTS ----------
// stock_events insert triggers a DB-side update of inventory.quantity (see migration),
// so this never has to read-modify-write the running total itself.
export async function logStockEvent({ mode, existingId, newItem, quantity, reason, note, session, orderId }) {
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
    order_id: orderId || null,
  });
  check(eventError);
}
