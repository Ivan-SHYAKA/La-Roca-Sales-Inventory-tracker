import { supabase } from "../supabaseClient";
import { mapAudit, check } from "./mappers";

// Manager only (row-level security returns nothing to anyone else). Newest first; `limit`
// grows when the manager asks for older activity.
export async function fetchAuditLog(limit = 300) {
  const { data, error } = await supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  check(error);
  return (data || []).map(mapAudit);
}

// "Mark all as read": remembers, on the manager's own profile, how far they've looked, so the
// unread count survives a refresh and follows them to another device.
export async function markActivitySeen(userId) {
  const { error } = await supabase.from("profiles").update({ activity_seen_at: new Date().toISOString() }).eq("id", userId);
  check(error);
}
