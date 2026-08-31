import { supabase } from "../supabaseClient";
import { mapFixedCost, check } from "./mappers";

export async function fetchFixedCosts() {
  const { data, error } = await supabase.from("fixed_costs").select("*").order("start_date", { ascending: false });
  check(error);
  return (data || []).map(mapFixedCost);
}

export async function addFixedCost(form, session) {
  const { error } = await supabase.from("fixed_costs").insert({
    name: form.name.trim(),
    category: form.category,
    amount: Number(form.amount) || 0,
    frequency: form.frequency,
    start_date: form.startDate,
    end_date: form.endDate || null,
    note: form.note || null,
    created_by: session.id,
    created_by_name: session.name,
  });
  check(error);
}

export async function removeFixedCost(id) {
  const { error } = await supabase.from("fixed_costs").delete().eq("id", id);
  check(error);
}
