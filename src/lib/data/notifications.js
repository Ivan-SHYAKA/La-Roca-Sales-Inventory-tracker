import { supabase } from "../supabaseClient";
import { mapNotification, check } from "./mappers";
import { fetchAllRows } from "./paging";

// A notification is addressed to a role, and it is "done" for the whole role as soon as one
// person acknowledges it -- or, for a new order, as soon as the order has been handled (the
// database marks it resolved). RLS lets people see their colleagues' acknowledgements, so a
// notification someone else already dealt with never pops up again for the rest of the role.
export async function fetchMyNotifications() {
  const notifs = await fetchAllRows(() =>
    supabase.from("notifications").select("*").is("resolved_at", null).order("created_at", { ascending: true }).order("id")
  );
  if (notifs.length === 0) return [];
  // Which of these anyone has already acknowledged (in chunks to keep the request short).
  const ackedIds = new Set();
  for (let i = 0; i < notifs.length; i += 150) {
    const ids = notifs.slice(i, i + 150).map((n) => n.id);
    const { data, error } = await supabase.from("notification_acks").select("notification_id").in("notification_id", ids);
    check(error);
    (data || []).forEach((a) => ackedIds.add(a.notification_id));
  }
  return notifs.filter((n) => !ackedIds.has(n.id)).map(mapNotification);
}

export async function acknowledgeNotification(notificationId, userId) {
  const { error } = await supabase.from("notification_acks").insert({ notification_id: notificationId, user_id: userId });
  check(error);
}
