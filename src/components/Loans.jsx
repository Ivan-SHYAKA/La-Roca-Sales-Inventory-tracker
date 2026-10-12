import { useMemo, useState } from "react";
import { Plus, ChevronDown, Trash2 } from "lucide-react";
import { Card, SectionLabel, Input, PrimaryBtn, Badge, Req, MissingHint, ConfirmModal } from "./ui";
import { fmt } from "../lib/format";
import { isBlank, isPositive } from "../lib/validate";
import { dayStr } from "../lib/cashBook";
import { addLoan, addLoanRepayment, removeLoan } from "../lib/data";

// Loans given to staff and management: who, how much, when, what has been paid back and what
// is still owed. Manager only. (Loans are kept separate from the cash book.)
export function Loans({ loans, repayments, session, refresh, onError }) {
  const today = dayStr(new Date());
  const [form, setForm] = useState({ person: "", amount: "", date: today, note: "" });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({});
  const [repay, setRepay] = useState({});       // per-loan repayment form text
  const [showCleared, setShowCleared] = useState(false);
  const [removing, setRemoving] = useState(null);

  const rows = useMemo(() => {
    const paidBy = {};
    const listBy = {};
    repayments.forEach((r) => {
      paidBy[r.loanId] = (paidBy[r.loanId] || 0) + r.amount;
      (listBy[r.loanId] ||= []).push(r);
    });
    return loans
      .map((l) => ({ ...l, repaid: paidBy[l.id] || 0, remaining: l.amount - (paidBy[l.id] || 0), repayments: (listBy[l.id] || []).sort((a, b) => a.paidOn.localeCompare(b.paidOn)) }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.person.localeCompare(b.person));
  }, [loans, repayments]);

  const outstanding = rows.reduce((s, l) => s + l.remaining, 0);
  const people = [...new Set(loans.map((l) => l.person))].sort();
  const visible = rows.filter((l) => showCleared || l.remaining > 0);

  const problems = [];
  if (isBlank(form.person)) problems.push("the person's name");
  if (!isPositive(form.amount)) problems.push("amount borrowed (more than 0)");
  if (isBlank(form.date)) problems.push("the date");

  const submit = async () => {
    if (problems.length) return;
    setBusy(true);
    try {
      await addLoan({ person: form.person, amount: Number(form.amount), date: form.date, note: form.note }, session);
      setForm({ person: "", amount: "", date: today, note: "" });
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't save the loan — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const repayProblems = (l) => {
    const f = repay[l.id] || {};
    const p = [];
    if (!isPositive(f.amount)) p.push("an amount (more than 0)");
    else if (Number(f.amount) > l.remaining) p.push(`an amount of at most RWF ${fmt(l.remaining)}`);
    if (isBlank(f.date ?? today)) p.push("the date");
    return p;
  };
  const submitRepay = async (l) => {
    const f = repay[l.id] || {};
    if (repayProblems(l).length) return;
    setBusy(true);
    try {
      await addLoanRepayment({ loanId: l.id, amount: Number(f.amount), date: f.date || today, note: f.note }, session);
      setRepay((r) => ({ ...r, [l.id]: {} }));
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't save the repayment — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {removing && (
        <ConfirmModal title="Remove this loan?" confirmLabel="Remove" confirmColor="var(--ember)" busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try { await removeLoan(removing.id); setRemoving(null); await refresh(); }
            catch (e) { onError?.(e.message || "Couldn't remove the loan."); }
            finally { setBusy(false); }
          }}
          onClose={() => setRemoving(null)}>
          <p className="text-sm">The loan of RWF {fmt(removing.amount)} to <b>{removing.person}</b> and its {removing.repayments.length} repayment{removing.repayments.length === 1 ? "" : "s"} will be deleted. Only do this for a mistake.</p>
        </ConfirmModal>
      )}

      <Card>
        <SectionLabel>Record a loan</SectionLabel>
        <datalist id="loan-people">{people.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div><label className="text-xs text-[var(--basalt)]/60">Person<Req /></label><Input list="loan-people" value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })} placeholder="Name of staff or manager" /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Amount borrowed (RWF)<Req /></label><Input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Date<Req /></label><Input type="date" value={form.date} max={today} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Note (optional)</label><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        </div>
        <MissingHint items={(form.person || form.amount) ? problems : []} className="mt-2" />
        <div className="flex justify-end mt-4">
          <PrimaryBtn color="var(--moss)" disabled={busy || problems.length > 0} onClick={submit}><Plus size={15} /> Save loan</PrimaryBtn>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <SectionLabel>Loans</SectionLabel>
          <div className="flex items-center gap-4 text-sm -mt-3">
            <span>Still owed: <b className="font-mono">RWF {fmt(outstanding)}</b></span>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showCleared} onChange={(e) => setShowCleared(e.target.checked)} /> Show fully repaid</label>
          </div>
        </div>
        {visible.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">{rows.length === 0 ? "No loans recorded yet." : "Nothing is owed right now."}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
                <th className="py-2 pr-3">Person</th><th className="py-2 pr-3">Date</th><th className="py-2 pr-3 text-right">Borrowed</th>
                <th className="py-2 pr-3 text-right">Repaid</th><th className="py-2 pr-3 text-right">Remaining</th><th className="py-2 pr-3"></th>
              </tr></thead>
              <tbody>
                {visible.map((l) => {
                  const f = repay[l.id] || {};
                  const rp = repayProblems(l);
                  return [
                    <tr key={l.id} className="border-b border-[var(--basalt)]/5">
                      <td className="py-2 pr-3">
                        <button onClick={() => setOpen((o) => ({ ...o, [l.id]: !o[l.id] }))} className="flex items-center gap-1 font-medium hover:underline" aria-expanded={!!open[l.id]}>
                          {l.person} <ChevronDown size={14} className="transition-transform" style={{ transform: open[l.id] ? "rotate(180deg)" : "none" }} />
                        </button>
                        {l.note && <div className="text-xs text-[var(--basalt)]/50">{l.note}</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs text-[var(--basalt)]/60">{new Date(l.date + "T12:00:00").toLocaleDateString()}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">RWF {fmt(l.amount)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs">RWF {fmt(l.repaid)}</td>
                      <td className="py-2 pr-3 text-right font-mono text-xs font-semibold" style={{ color: l.remaining > 0 ? "var(--ember)" : "var(--moss)" }}>
                        {l.remaining > 0 ? `RWF ${fmt(l.remaining)}` : <Badge color="#46583F">repaid</Badge>}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <button onClick={() => setRemoving(l)} aria-label="Remove this loan"><Trash2 size={14} className="text-[var(--basalt)]/30" /></button>
                      </td>
                    </tr>,
                    open[l.id] && (
                      <tr key={l.id + "-d"} className="border-b border-[var(--basalt)]/5 bg-[var(--basalt)]/[0.03]">
                        <td colSpan={6} className="py-3 px-3">
                          {l.repayments.length === 0 ? <p className="text-xs text-[var(--basalt)]/50 mb-2">No repayments yet.</p> : (
                            <ul className="text-xs mb-3 space-y-0.5">
                              {l.repayments.map((r) => (
                                <li key={r.id}>{new Date(r.paidOn + "T12:00:00").toLocaleDateString()} — repaid <span className="font-mono">RWF {fmt(r.amount)}</span>{r.note ? ` — ${r.note}` : ""}</li>
                              ))}
                            </ul>
                          )}
                          {l.remaining > 0 && (
                            <div>
                              <div className="flex flex-wrap items-end gap-2">
                                <div><label className="text-xs text-[var(--basalt)]/60">Repaid (RWF)<Req /></label><Input type="number" min="0" value={f.amount || ""} onChange={(e) => setRepay((r) => ({ ...r, [l.id]: { ...f, amount: e.target.value } }))} className="w-36" /></div>
                                <div><label className="text-xs text-[var(--basalt)]/60">Date<Req /></label><Input type="date" value={f.date ?? today} max={today} onChange={(e) => setRepay((r) => ({ ...r, [l.id]: { ...f, date: e.target.value } }))} className="w-40" /></div>
                                <div className="flex-1 min-w-[140px]"><label className="text-xs text-[var(--basalt)]/60">Note (optional)</label><Input value={f.note || ""} onChange={(e) => setRepay((r) => ({ ...r, [l.id]: { ...f, note: e.target.value } }))} /></div>
                                <PrimaryBtn color="var(--moss)" disabled={busy || rp.length > 0} onClick={() => submitRepay(l)}>Record repayment</PrimaryBtn>
                              </div>
                              {f.amount ? <MissingHint items={rp} className="mt-1" /> : null}
                            </div>
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
