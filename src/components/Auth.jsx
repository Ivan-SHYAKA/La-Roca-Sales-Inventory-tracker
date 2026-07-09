import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Card, SectionLabel, Input, PasswordInput, Select, Badge, PrimaryBtn, ConfirmModal } from "./ui";
import { supabase, emailForUsername, callAdminUsers } from "../lib/supabaseClient";
import { toggleUserActive } from "../lib/data";
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

export function LoginForm() {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    const { data: profile } = await supabase.from("profiles").select("active").eq("id", data.user.id).single();
    if (!profile?.active) {
      setError("This account has been deactivated.");
      await supabase.auth.signOut();
    }
    setBusy(false);
  };

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
        <p className="text-xs text-[var(--basalt)]/40 mt-4">Ask your manager for an account if you don't have one yet.</p>
      </Card>
    </div>
  );
}

export function UsersManager({ users, session, refreshUsers, onError }) {
  const [form, setForm] = useState({ name: "", username: "", password: "", role: "sales" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const addUser = async () => {
    if (!form.name || !form.username || !form.password) return;
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
      <Card>
        <SectionLabel>Create staff account</SectionLabel>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <div><label className="text-xs text-[var(--basalt)]/60">Full name</label><Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Username</label><Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Password</label><PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Role</label><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        </div>
        {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
        <div className="flex justify-end mt-4"><PrimaryBtn color="var(--basalt)" disabled={busy} onClick={addUser}><Plus size={15} /> Create account</PrimaryBtn></div>
      </Card>
      <Card>
        <SectionLabel>Staff accounts</SectionLabel>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Username</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
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

function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ name: user.name, username: user.username, role: user.role, password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form.name.trim() || !form.username.trim()) { setError("Name and username can't be empty."); return; }
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
        <div><label className="text-xs text-[var(--basalt)]/60">Full name</label><Input autoComplete="off" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Username</label><Input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Role</label><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        <div><label className="text-xs text-[var(--basalt)]/60">New password (optional)</label><PasswordInput autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Leave blank to keep current password" /></div>
      </div>
      {error && <p className="text-xs text-[var(--ember)] mt-2">{error}</p>}
    </ConfirmModal>
  );
}
