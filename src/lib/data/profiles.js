import { supabase } from "../supabaseClient";
import { mapProfile, check } from "./mappers";

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

// ---------- USERS ----------
export async function toggleUserActive(userId, active) {
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId);
  check(error);
}
