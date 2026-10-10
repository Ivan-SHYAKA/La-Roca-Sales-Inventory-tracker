import { supabase } from "../supabaseClient";

// ---------- REALTIME ----------
// Any change to a watched table triggers a full refetch of that screen's data.
// Simpler and less bug-prone than patching local state incrementally, and the
// data volumes here are small enough that refetching is cheap.
// Changes that arrive in a burst (saving a whole daily sheet writes dozens of rows at
// once) are collapsed into one refetch shortly after the last of them.
const SETTLE_MS = 400;
export function subscribeToChanges(tables, onChange) {
  const channel = supabase.channel(`lr-${tables.join("-")}-${Math.random().toString(36).slice(2)}`);
  let timer = null;
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, SETTLE_MS);
  };
  tables.forEach((table) => {
    channel.on("postgres_changes", { event: "*", schema: "public", table }, settle);
  });
  channel.subscribe();
  return () => {
    clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}
