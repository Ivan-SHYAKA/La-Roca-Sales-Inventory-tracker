import { supabase } from "../supabaseClient";
import { mapInventory, mapStockEvent, check } from "./mappers";
import { fetchAllRows } from "./paging";

export async function fetchInventory() {
  const rows = await fetchAllRows(() => supabase.from("inventory").select("*").order("created_at", { ascending: false }).order("id"));
  return rows.map(mapInventory);
}
export async function fetchStockEvents() {
  const rows = await fetchAllRows(() => supabase.from("stock_events").select("*").order("date", { ascending: false }).order("id"));
  return rows.map(mapStockEvent);
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
        category: (newItem.category || "").trim() || null,
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

// Several stock entries in one request: either every one of them is saved or none is
// (a single insert statement), so a daily sheet can't end up half-saved.
export async function logStockEvents(events, session) {
  if (!events.length) return;
  const { error } = await supabase.from("stock_events").insert(
    events.map((e) => ({
      inventory_id: e.invId,
      type: e.type,
      reason: e.reason,
      quantity: e.quantity,
      date: e.date,
      user_id: session.id,
      user_name: session.name,
      note: e.note || null,
    }))
  );
  check(error);
}

// A new item on the sheet. Its starting quantity (if any) goes in as a stock-in, like every
// other change to a quantity, so the ledger always explains the number.
export async function createInventoryItem({ name, line, category, unit, reorderLevel, costPerUnit, quantity, session }) {
  const { data: item, error } = await supabase
    .from("inventory")
    .insert({
      name: name.trim(),
      line,
      category: (category || "").trim() || null,
      unit,
      quantity: 0,
      reorder_level: Number(reorderLevel) || 0,
      cost_per_unit: Number(costPerUnit) || 0,
    })
    .select()
    .single();
  check(error);
  if (Number(quantity) > 0) {
    await logStockEvents([{ invId: item.id, type: "in", reason: "restock", quantity: Number(quantity), date: new Date().toISOString(), note: "Opening quantity of a new item" }], session);
  }
  return item.id;
}

// Item details (name, unit, category, reorder level, price). Quantity is never touched here —
// it only ever changes through stock entries.
export async function updateInventoryItems(changes) {
  for (let i = 0; i < changes.length; i += 20) {
    const results = await Promise.all(
      changes.slice(i, i + 20).map((c) =>
        supabase.from("inventory").update({
          name: c.name.trim(),
          line: c.line,
          category: (c.category || "").trim() || null,
          unit: c.unit,
          reorder_level: Number(c.reorderLevel) || 0,
          cost_per_unit: Number(c.costPerUnit) || 0,
        }).eq("id", c.id)
      )
    );
    results.forEach((r) => check(r.error));
  }
}
