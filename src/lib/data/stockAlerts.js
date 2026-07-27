import { supabase } from "../supabaseClient";
import { mapStockAlert, check } from "./mappers";

export async function fetchStockAlerts() {
  const { data, error } = await supabase
    .from("stock_alerts")
    .select("*")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  check(error);
  return (data || []).map(mapStockAlert);
}

export async function resolveStockAlert(id) {
  const { error } = await supabase.from("stock_alerts").update({ resolved: true }).eq("id", id);
  check(error);
}

export async function insertStockAlert({ inventoryId, orderId, menuItemId, message, severity }) {
  const { error } = await supabase.from("stock_alerts").insert({
    inventory_id: inventoryId || null,
    order_id: orderId || null,
    menu_item_id: menuItemId || null,
    message,
    severity,
  });
  check(error);
}

// Read-only pre-check the app calls before placing an order — returns one row per
// ingredient that's short (empty array = fine to proceed).
export async function checkOrderItemAvailability(menuItemId, qty) {
  const { data, error } = await supabase.rpc("check_order_item_availability", {
    p_menu_item_id: menuItemId,
    p_qty: qty,
  });
  check(error);
  return data || [];
}
