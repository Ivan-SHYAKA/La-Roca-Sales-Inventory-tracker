import { supabase } from "../supabaseClient";

// ---------- REALTIME ----------
// Any change to a watched table triggers a full refetch of that screen's data.
// Simpler and less bug-prone than patching local state incrementally, and the
// data volumes here are small enough that refetching is cheap.
export function subscribeToChanges(tables, onChange) {
  const channel = supabase.channel(`lr-${tables.join("-")}-${Math.random().toString(36).slice(2)}`);
  tables.forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, onChange);
  });
  channel.subscribe();
  return () => supabase.removeChannel(channel);
}
