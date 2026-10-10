import { supabase } from "../supabaseClient";
import { mapMenuItem, check } from "./mappers";
import { fetchAllRows } from "./paging";

export async function fetchMenu() {
  const rows = await fetchAllRows(() =>
    supabase.from("menu_items").select("*, recipe_ingredients(*)").order("created_at", { ascending: false }).order("id")
  );
  return rows.map(mapMenuItem);
}

// ---------- MENU ----------
export async function addMenuItem(form, recipe) {
  const { data: item, error } = await supabase
    .from("menu_items")
    .insert({
      name: form.name.trim(),
      line: form.line,
      price: Number(form.price) || 0,
      prep_minutes: Number(form.prepMinutes),
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
      prep_minutes: Number(form.prepMinutes),
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
export async function setMenuItemActive(id, active) {
  const { error } = await supabase.from("menu_items").update({ active }).eq("id", id);
  check(error);
}
