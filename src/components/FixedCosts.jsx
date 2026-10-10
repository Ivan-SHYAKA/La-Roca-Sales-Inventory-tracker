import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, SectionLabel, Input, Select, Badge, PrimaryBtn, Req, MissingHint } from "./ui";
import { isBlank, isPositive } from "../lib/validate";
import { fmt } from "../lib/format";
import { addFixedCost, removeFixedCost } from "../lib/data";

const CATEGORIES = { salaries: "Salaries", utilities: "Utilities", rent: "Rent", other: "Other" };
const CATEGORY_COLOR = { salaries: "var(--ember)", utilities: "var(--gold)", rent: "var(--moss)", other: "var(--basalt)" };

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const emptyForm = { name: "", category: "salaries", amount: "", frequency: "monthly", startDate: todayStr(), endDate: "", note: "" };

// Fixed costs the business pays regardless of sales volume -- these feed straight into the
// Dashboard's profit/loss figure alongside revenue and ingredient cost.
export function FixedCosts({ fixedCosts, session, refresh, onError }) {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const problems = [];
  if (isBlank(form.name)) problems.push("name");
  if (!isPositive(form.amount)) problems.push("amount (more than 0)");
  if (isBlank(form.startDate)) problems.push("start date");
  if (form.endDate && form.startDate && form.endDate < form.startDate) problems.push("an end date that isn't before the start date");

  const submit = async () => {
    if (problems.length) return;
    setBusy(true);
    try {
      await addFixedCost(form, session);
      setForm(emptyForm);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't save the fixed cost — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    try {
      await removeFixedCost(id);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't remove the fixed cost — check your connection and try again.");
    }
  };

  const sorted = [...fixedCosts].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Add a fixed cost</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Costs that happen regardless of sales — rent, salaries, utilities. A monthly cost counts once for every month it's active when the dashboard works out profit and loss for a period.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-xs text-[var(--basalt)]/60">Name<Req /></label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Chef salary" /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Category</label><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Amount (RWF)<Req /></label><Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Frequency</label><Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}><option value="monthly">Every month</option><option value="one_time">One time</option></Select></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Starts<Req /></label><Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Ends (optional)</label><Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></div>
          <div className="col-span-2"><label className="text-xs text-[var(--basalt)]/60">Note (optional)</label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        </div>
        <div className="flex justify-end mt-4"><PrimaryBtn color="var(--moss)" disabled={busy || problems.length > 0} onClick={submit}><Plus size={15} /> Add fixed cost</PrimaryBtn></div>
        <MissingHint items={problems} className="mt-2 text-right" />
      </Card>

      <Card>
        <SectionLabel>Fixed costs</SectionLabel>
        {sorted.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">None recorded yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
              <th className="py-2 pr-3">Name</th><th className="py-2 pr-3">Category</th><th className="py-2 pr-3">Amount</th><th className="py-2 pr-3">Frequency</th><th className="py-2 pr-3">Active</th><th></th>
            </tr></thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="border-b border-[var(--basalt)]/5">
                  <td className="py-2 pr-3">{c.name}{c.note && <span className="text-xs text-[var(--basalt)]/40 block">{c.note}</span>}</td>
                  <td className="py-2 pr-3"><Badge color={CATEGORY_COLOR[c.category]}>{CATEGORIES[c.category]}</Badge></td>
                  <td className="py-2 pr-3 font-mono text-xs">RWF {fmt(c.amount)}</td>
                  <td className="py-2 pr-3 text-xs">{c.frequency === "monthly" ? "Every month" : "One time"}</td>
                  <td className="py-2 pr-3 text-xs text-[var(--basalt)]/60">{c.startDate}{c.endDate ? ` – ${c.endDate}` : " – ongoing"}</td>
                  <td className="py-2"><button onClick={() => remove(c.id)} aria-label={`Delete ${c.name}`}><Trash2 size={14} className="text-[var(--basalt)]/30 hover:text-[var(--ember)]" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
