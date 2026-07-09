import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill in your Supabase project's keys."
  );
}

export const supabase = createClient(url, anonKey);

export const emailForUsername = (username) => `${username.trim().toLowerCase()}@laroca.internal`;

export async function callAdminUsers(body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (error) {
    let message = error.message;
    try {
      const parsed = await error.context.json();
      if (parsed?.error) message = parsed.error;
    } catch (_) { /* use default message */ }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
