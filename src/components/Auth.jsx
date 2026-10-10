import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Card, SectionLabel, Input, PasswordInput, Select, Badge, PrimaryBtn, ConfirmModal, Req, MissingHint } from "./ui";
import { isBlank } from "../lib/validate";

// Same rules the server enforces for sign-ups, so the form can say what is wrong before saving.
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/i;
function accountProblems(f, { passwordRequired }) {
  const p = [];
  if (isBlank(f.name) || f.name.trim().length < 2) p.push("full name");
  if (!USERNAME_RE.test((f.username || "").trim())) p.push("username (3-30 letters, numbers, dots, dashes or underscores)");
  if (passwordRequired ? (f.password || "").length < 8 : (f.password && f.password.length < 8)) p.push("password of at least 8 characters");
  return p;
}
import { supabase, emailForUsername, callAdminUsers } from "../lib/supabaseClient";
import { toggleUserActive, approveSignup } from "../lib/data";
import { ROLES } from "../lib/constants";
import logo from "../assets/la-roca-logo.svg";

export function SetupAdmin() {
  const [form, setForm] = useState({ name: "", username: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!form.name || !form.username || !form.password) return;
    setBusy(true); setError("");
    try {
      await callAdminUsers({ name: form.name, username: form.username, password: form.password, role: "manager" });
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: emailForUsername(form.username),
        password: form.password,
      });
      if (signInError) throw signInError;
    } catch (e) {
      setError(e.message || "Couldn't create the admin account.");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <img src={logo} alt="La Roca" className="w-24 h-24 mx-auto mb-3" />
        <h2 className="lr-display text-2xl mb-1">Set up La Roca</h2>
        <p className="text-sm text-[var(--basalt)]/60 mb-4">No accounts exist yet. Create the first Manager/Admin account to get started.</p>
        <label className="text-xs text-[var(--basalt)]/60">Full name</label>
        <Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <label className="text-xs text-[var(--basalt)]/60 mt-3 block">Username</label>
        <Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <label className="text-xs text-[var(--basalt)]/60 mt-3 block">Password</label>
        <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
        <button disabled={busy} onClick={submit} className="w-full mt-4 py-2 rounded text-sm font-medium text-white" style={{ background: "var(--basalt)" }}>
          {busy ? "Creating…" : "Create admin account"}
        </button>
      </Card>
    </div>
  );
}

// Anyone can register themselves, but the account stays inactive (and can't see anything)
// until a manager approves it and assigns a role in the Users panel.
function SignupForm({ onBack }) {
  const [form, setForm] = useState({ name: "", username: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (!form.name.trim() || !form.username.trim() || !form.password) { setError("Fill in all the fields."); return; }
    if (form.password !== form.confirm) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    try {
      await callAdminUsers({ action: "signup", name: form.name, username: form.username, password: form.password });
      setDone(true);
    } catch (e) {
      setError(e.message || "Couldn't create the account — check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <img src={logo} alt="La Roca" className="w-24 h-24 mx-auto mb-2" />
        {done ? (
          <>
            <h2 className="lr-display text-2xl mb-2 text-center">Account created</h2>
            <p className="text-sm text-[var(--basalt)]/70 mb-4">A manager needs to approve your account and assign your role before you can sign in. Check back with them once you've asked.</p>
            <button onClick={onBack} className="w-full py-2 rounded text-sm font-medium text-white" style={{ background: "var(--basalt)" }}>Back to sign in</button>
          </>
        ) : (
          <>
            <h2 className="lr-display text-2xl mb-4 text-center">Create your account</h2>
            <label className="text-xs text-[var(--basalt)]/60">Full name</label>
            <Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label className="text-xs text-[var(--basalt)]/60 mt-3 block">Username</label>
            <Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="3-30 letters or numbers" />
            <label className="text-xs text-[var(--basalt)]/60 mt-3 block">Password</label>
            <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" />
            <label className="text-xs text-[var(--basalt)]/60 mt-3 block">Confirm password</label>
            <PasswordInput autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
            {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
            <button disabled={busy} onClick={submit} className="w-full mt-4 py-2 rounded text-sm font-medium text-white" style={{ background: "var(--basalt)" }}>
              {busy ? "Creating…" : "Create account"}
            </button>
            <button onClick={onBack} className="w-full mt-2 text-xs text-[var(--basalt)]/60 underline">I already have an account</button>
          </>
        )}
      </Card>
    </div>
  );
}

export function LoginForm() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  const submit = async () => {
    setBusy(true); setError("");
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: emailForUsername(form.username),
      password: form.password,
    });
    if (signInError) {
      setError("Incorrect username or password.");
      setBusy(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("active, signup_pending").eq("id", data.user.id).single();
    if (!profile?.active) {
      setError(profile?.signup_pending
        ? "Your account is still waiting for a manager's approval. You'll be able to sign in once it's approved."
        : "This account has been deactivated.");
      await supabase.auth.signOut();
    }
    setBusy(false);
  };

  if (signingUp) return <SignupForm onBack={() => setSigningUp(false)} />;

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <img src={logo} alt="La Roca" className="w-24 h-24 mx-auto mb-2" />
        <h2 className="lr-display text-2xl mb-4 text-center">Sign in to La Roca</h2>
        <label className="text-xs text-[var(--basalt)]/60">Username</label>
        <Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <label className="text-xs text-[var(--basalt)]/60 mt-3 block">Password</label>
        <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && document.getElementById("lr-login-btn").click()} />
        {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
        <button id="lr-login-btn" disabled={busy} onClick={submit} className="w-full mt-4 py-2 rounded text-sm font-medium text-white" style={{ background: "var(--basalt)" }}>
          {busy ? "Checking…" : "Sign in"}
        </button>
        <p className="text-xs text-[var(--basalt)]/50 mt-4">
          New here? <button onClick={() => setSigningUp(true)} className="underline">Create an account</button> — a manager approves it before you can sign in.
        </p>
      </Card>
    </div>
  );
}

export function UsersManager({ users, session, refreshUsers, onError }) {
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "sales" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [roleFor, setRoleFor] = useState({}); // role chosen per pending sign-up, keyed by user id
  const [rejecting, setRejecting] = useState(null);
  const [rejectBusy, setRejectBusy] = useState(false);

  const pending = users.filter((u) => u.signupPending);
  const staff = users.filter((u) => !u.signupPending);

  const approve = async (u) => {
    try {
      await approveSignup(u.id, roleFor[u.id] || "waiter");
      await refreshUsers();
    } catch (e) {
      onError?.(e.message || "Couldn't approve that account — check your connection and try again.");
    }
  };
  const reject = async () => {
    setRejectBusy(true);
    try {
      await callAdminUsers({ action: "reject", userId: rejecting.id });
      setRejecting(null);
      await refreshUsers();
    } catch (e) {
      onError?.(e.message || "Couldn't reject that sign-up — check your connection and try again.");
    } finally {
      setRejectBusy(false);
    }
  };

  const createProblems = accountProblems(form, { passwordRequired: true });
  const addUser = async () => {
    if (createProblems.length) return;
    setBusy(true); setError("");
    try {
      await callAdminUsers({ name: form.name, username: form.username, password: form.password, role: form.role });
      setForm({ name: "", username: "", password: "", role: form.role });
      await refreshUsers();
    } catch (e) {
      setError(e.message || "Couldn't create the account.");
    }
    setBusy(false);
  };
  const toggleActive = async (u) => {
    try {
      await toggleUserActive(u.id, !u.active);
      await refreshUsers();
    } catch (e) {
      onError?.(e.message || "Couldn't update that account — check your connection and try again.");
    }
  };

  return (
    <div className="space-y-6">
      {editingUser && (
        <EditUserModal user={editingUser} onClose={() => setEditingUser(null)}
          onSaved={async () => { setEditingUser(null); await refreshUsers(); }} />
      )}
      {rejecting && (
        <ConfirmModal title="Reject sign-up?" confirmLabel="Reject" confirmColor="var(--ember)" busy={rejectBusy} onConfirm={reject} onClose={() => setRejecting(null)}>
          <p className="text-sm">This permanently removes {rejecting.name} ({rejecting.username}). They can sign up again if it was a mistake.</p>
        </ConfirmModal>
      )}
      {pending.length > 0 && (
        <Card>
          <SectionLabel>Waiting for approval ({pending.length})</SectionLabel>
          <p className="text-xs text-[var(--basalt)]/50 mb-3">These people created their own account. They can't see anything until you approve them and pick their role.</p>
          <div className="space-y-3">
            {pending.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded border border-[var(--basalt)]/10">
                <div>
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="text-xs font-mono text-[var(--basalt)]/50">{u.username}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-44"><Select value={roleFor[u.id] || "waiter"} onChange={(e) => setRoleFor({ ...roleFor, [u.id]: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
                  <PrimaryBtn color="var(--moss)" onClick={() => approve(u)}>Approve</PrimaryBtn>
                  <button onClick={() => setRejecting(u)} className="px-3 py-2 rounded text-sm border border-[var(--basalt)]/20">Reject</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <SectionLabel>Create staff account</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div><label className="text-xs text-[var(--basalt)]/60">Full name<Req /></label><Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Username<Req /></label><Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Password<Req /></label><PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Role<Req /></label><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        </div>
        {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
        <div className="flex justify-end mt-4"><PrimaryBtn color="var(--basalt)" disabled={busy || createProblems.length > 0} onClick={addUser}><Plus size={15} /> Create account</PrimaryBtn></div>
        <MissingHint items={(form.name || form.username || form.password) ? createProblems : ["full name", "username", "password"]} className="mt-2 text-right" />
      </Card>
      <Card>
        <SectionLabel>Staff accounts</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Passwords are stored securely and can't be viewed by anyone, including you. If someone forgets theirs, open Edit and set a new one for them.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Username</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Status</th><th></th></tr></thead>
          <tbody>
            {staff.map((u) => (
              <tr key={u.id} className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3">{u.name}</td><td className="py-2 pr-3 font-mono text-xs">{u.username}</td><td className="py-2 pr-3">{ROLES[u.role]}</td>
                <td className="py-2 pr-3">{u.active ? <Badge color="var(--moss)">Active</Badge> : <Badge color="var(--ember)">Disabled</Badge>}</td>
                <td className="py-2 flex items-center gap-3">
                  <button onClick={() => setEditingUser(u)} aria-label={`Edit ${u.name}`}><Pencil size={14} className="text-[var(--basalt)]/40 hover:text-[var(--moss)]" /></button>
                  {u.id !== session.id && <button onClick={() => toggleActive(u)} className="text-xs text-[var(--basalt)]/60 underline">{u.active ? "Disable" : "Enable"}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// Readable on a phone screen and easy to say aloud: no 0/O or 1/l/I lookalikes.
function generatePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), (n) => chars[n % chars.length]).join("");
}

function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ name: user.name, username: user.username, role: user.role, password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const problems = accountProblems(form, { passwordRequired: false });
  const save = async () => {
    if (problems.length) { setError("Needed before saving: " + problems.join(", ") + "."); return; }
    setBusy(true); setError("");
    try {
      await callAdminUsers({
        action: "update",
        userId: user.id,
        name: form.name,
        username: form.username,
        role: form.role,
        ...(form.password ? { password: form.password } : {}),
      });
      onSaved();
    } catch (e) {
      setError(e.message || "Couldn't update the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmModal title={`Edit ${user.name}`} confirmLabel="Save changes" confirmColor="var(--moss)" busy={busy} onConfirm={save} onClose={onClose}>
      <div className="space-y-3">
        <div><label className="text-xs text-[var(--basalt)]/60">Full name<Req /></label><Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Username<Req /></label><Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Role</label><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-[var(--basalt)]/60">New password (optional)</label>
            <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })} className="text-xs underline text-[var(--basalt)]/60">Generate one</button>
          </div>
          <PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to keep current password" />
          {form.password && <p className="text-xs text-[var(--basalt)]/50 mt-1">Tell them to sign in with: <span className="font-mono text-[var(--basalt)]">{form.password}</span></p>}
        </div>
      </div>
      {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
    </ConfirmModal>
  );
}
