import { supabase } from "../supabaseClient";
import { mapNotification, check } from "./mappers";
import { fetchAllRows } from "./paging";

// RLS already scopes `notifications` to rows matching the caller's role, so this only
// needs to subtract the ones this specific user has already acknowledged — two people
// sharing a role (e.g. two kitchen staff) each get their own copy of the same broadcast
// notification and must acknowledge it independently.
export async function fetchMyNotifications(userId) {
  const [notifs, acks] = await Promise.all([
    fetchAllRows(() => supabase.from("notifications").select("*").order("created_at", { ascending: true }).order("id")),
    fetchAllRows(() => supabase.from("notification_acks").select("notification_id").eq("user_id", userId).order("notification_id")),
  ]);
  const ackedIds = new Set(acks.map((a) => a.notification_id));
  return notifs.filter((n) => !ackedIds.has(n.id)).map(mapNotification);
}

export async function acknowledgeNotification(notificationId, userId) {
  const { error } = await supabase.from("notification_acks").insert({ notification_id: notificationId, user_id: userId });
  check(error);
}
