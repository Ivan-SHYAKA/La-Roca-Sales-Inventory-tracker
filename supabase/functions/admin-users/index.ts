// Creates and edits staff accounts using the Supabase Auth admin API.
// Must run server-side (Edge Function) because it needs the service_role key,
// which is never shipped to the browser bundle.
//
// Actions, selected by body.action ("create" is the default for backward compat):
//  - signup: public. A new person registers themselves; the account is created inactive and
//    flagged signup_pending, with no access until a manager approves it (see handleSignup).
//  - reject: manager-only. Deletes an account that is still waiting for approval.
//  - create: two ways in —
//     1. Bootstrap: no accounts exist yet (profiles table empty) -> anyone can create
//        the first manager account (mirrors the original prototype's "Set up La Roca" screen).
//     2. Normal: caller must be an authenticated, active manager -> can create any role.
//  - update: caller must always be an authenticated, active manager (no bootstrap case —
//    there's nothing to update before any account exists). Can change name/username/role
//    and optionally reset the password. Username changes also update the synthetic auth
//    email, since that's what actually backs sign-in.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
// Supabase auto-injects the project's service-role credential into every edge function,
// but the env var name differs between the legacy JWT key system and the newer
// publishable/secret key system — check both so this works either way.
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY");

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ROLES = ["manager", "waiter", "sales", "kitchen", "barista", "storekeeper"];
const emailFor = (username) => `${username}@laroca.internal`;

async function requireActiveManager(req) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const { data: callerData, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !callerData?.user) return { error: json({ error: "Not signed in." }, 401) };

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, active")
    .eq("id", callerData.user.id)
    .single();
  if (!callerProfile?.active || callerProfile.role !== "manager") {
    return { error: json({ error: "Only an active manager can do this." }, 403) };
  }
  return { callerId: callerData.user.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    if (body.action === "update") return await handleUpdate(body, req);
    if (body.action === "signup") return await handleSignup(body);
    if (body.action === "reject") return await handleReject(body, req);
    return await handleCreate(body, req);
  } catch (e) {
    return json({ error: e.message || "Unexpected error." }, 500);
  }
});

async function handleCreate(body, req) {
  const { name, username, password, role } = body;

  if (!name?.trim() || !username?.trim() || !password || !ROLES.includes(role)) {
    return json({ error: "Missing or invalid fields." }, 400);
  }
  const cleanUsername = username.trim().toLowerCase();

  const { count, error: countError } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (countError) return json({ error: countError.message }, 500);
  const isBootstrap = (count || 0) === 0;

  if (isBootstrap && role !== "manager") {
    return json({ error: "The first account must be a manager." }, 400);
  }

  if (!isBootstrap) {
    const auth = await requireActiveManager(req);
    if (auth.error) return auth.error;
  }

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("username", cleanUsername)
    .maybeSingle();
  if (existing) return json({ error: "That username is already taken." }, 409);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: emailFor(cleanUsername),
    password,
    email_confirm: true,
  });
  if (createError) return json({ error: createError.message }, 400);

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    username: cleanUsername,
    name: name.trim(),
    role,
    active: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profileError.message }, 400);
  }

  return json({ ok: true, id: created.user.id });
}

// Public on purpose (a new person has no account to authenticate with yet), so it does only
// what's safe for a stranger: creates an INACTIVE, pending profile that grants no access
// until a manager approves it. Capped so it can't be used to flood the Users panel.
const MAX_PENDING_SIGNUPS = 20;

async function handleSignup(body) {
  const cleanName = (body.name || "").trim();
  const cleanUsername = (body.username || "").trim().toLowerCase();
  const password = body.password;

  if (cleanName.length < 2 || cleanName.length > 60) return json({ error: "Enter your full name." }, 400);
  if (!/^[a-z0-9._-]{3,30}$/.test(cleanUsername)) {
    return json({ error: "Username must be 3-30 characters: letters, numbers, dots, dashes or underscores." }, 400);
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    return json({ error: "Password must be 8-72 characters." }, 400);
  }

  const { count: total } = await admin.from("profiles").select("id", { count: "exact", head: true });
  if ((total || 0) === 0) {
    return json({ error: "No accounts exist yet — the first manager is created from the setup screen." }, 400);
  }
  const { count: pending } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("signup_pending", true);
  if ((pending || 0) >= MAX_PENDING_SIGNUPS) {
    return json({ error: "Too many sign-ups are waiting for approval. Ask your manager to review them first." }, 429);
  }

  const { data: existing } = await admin.from("profiles").select("id").eq("username", cleanUsername).maybeSingle();
  if (existing) return json({ error: "That username is already taken." }, 409);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: emailFor(cleanUsername),
    password,
    email_confirm: true,
  });
  if (createError) return json({ error: createError.message }, 400);

  const { error: profileError } = await admin.from("profiles").insert({
    id: created.user.id,
    username: cleanUsername,
    name: cleanName,
    role: "waiter", // placeholder only -- the manager assigns the real role on approval
    active: false,
    signup_pending: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return json({ error: profileError.message }, 400);
  }
  return json({ ok: true });
}

// Manager-only, and only for accounts that are still waiting for approval -- this can't be
// used to delete an established account (those are disabled, not removed).
async function handleReject(body, req) {
  const auth = await requireActiveManager(req);
  if (auth.error) return auth.error;

  const { userId } = body;
  if (!userId) return json({ error: "Missing userId." }, 400);
  const { data: target } = await admin
    .from("profiles")
    .select("id, active, signup_pending")
    .eq("id", userId)
    .maybeSingle();
  if (!target) return json({ error: "Account not found." }, 404);
  if (!target.signup_pending || target.active) {
    return json({ error: "Only accounts still waiting for approval can be rejected." }, 400);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json({ error: error.message }, 400);
  return json({ ok: true });
}

async function handleUpdate(body, req) {
  const auth = await requireActiveManager(req);
  if (auth.error) return auth.error;

  const { userId, name, username, role, password } = body;
  if (!userId) return json({ error: "Missing userId." }, 400);
  if (role !== undefined && !ROLES.includes(role)) return json({ error: "Invalid role." }, 400);

  const { data: target } = await admin.from("profiles").select("id, username").eq("id", userId).maybeSingle();
  if (!target) return json({ error: "Account not found." }, 404);

  let cleanUsername;
  if (username !== undefined) {
    cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername) return json({ error: "Username can't be empty." }, 400);
    if (cleanUsername !== target.username) {
      const { data: existing } = await admin
        .from("profiles")
        .select("id")
        .eq("username", cleanUsername)
        .maybeSingle();
      if (existing) return json({ error: "That username is already taken." }, 409);
      const { error: emailError } = await admin.auth.admin.updateUserById(userId, { email: emailFor(cleanUsername) });
      if (emailError) return json({ error: emailError.message }, 400);
    }
  }

  if (password) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(userId, { password });
    if (passwordError) return json({ error: passwordError.message }, 400);
  }

  const patch = {};
  if (name !== undefined && name.trim()) patch.name = name.trim();
  if (role !== undefined) patch.role = role;
  if (cleanUsername !== undefined) patch.username = cleanUsername;

  if (Object.keys(patch).length) {
    const { error: profileError } = await admin.from("profiles").update(patch).eq("id", userId);
    if (profileError) return json({ error: profileError.message }, 400);
  }

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
