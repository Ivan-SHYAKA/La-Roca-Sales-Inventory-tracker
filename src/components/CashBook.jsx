import { useMemo, useState } from "react";
import { Save } from "lucide-react";
import { Card, SectionLabel, Input, PrimaryBtn, MissingHint } from "./ui";
import { buildCashBook, dayStr } from "../lib/cashBook";
import { fmt } from "../lib/format";
import { isNonNegative, isBlank } from "../lib/validate";
import { saveCashBookDay } from "../lib/data";

const diffColor = (d) => (d == null || d === 0 ? "inherit" : d > 0 ? "var(--moss)" : "var(--ember)");
const diffText = (d) => (d == null ? "—" : d === 0 ? "matches" : `${d > 0 ? "+" : "−"}RWF ${fmt(Math.abs(d))}`);

// Opening balance and end-of-day count for cash and MoMo, compared with what the system
// expects from the day's payments. Manager only.
export function CashBook({ orders, days, session, refresh, onError }) {
  const [date, setDate] = useState(dayStr(new Date()));
  const [form, setForm] = useState({});     // text typed for the selected day, keyed by field
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  const rows = useMemo(() => buildCashBook(orders, days, date), [orders, days, date]);
  const row = rows.find((r) => r.day === date);
  const entry = days.find((d) => d.day === date);
  const hasAnyOpening = days.some((d) => d.openingCash != null || d.openingMomo != null);

  const val = (key, fromEntry) => (form[key] !== undefined ? form[key] : fromEntry == null ? "" : String(fromEntry));
  const fields = {
    openingCash: val("openingCash", entry?.openingCash),
    openingMomo: val("openingMomo", entry?.openingMomo),
    closingCash: val("closingCash", entry?.closingCash),
    closingMomo: val("closingMomo", entry?.closingMomo),
    note: form.note !== undefined ? form.note : entry?.note || "",
  };
  const changeDate = (d) => { if (d) { setDate(d); setForm({}); setSaved(""); } };
  const set = (k) => (e) => { setSaved(""); setForm((f) => ({ ...f, [k]: e.target.value })); };

  const problems = [];
  ["openingCash", "openingMomo", "closingCash", "closingMomo"].forEach((k) => {
    if (!isBlank(fields[k]) && !isNonNegative(fields[k])) problems.push("amounts of 0 or more");
  });
  const nothingYet = ["openingCash", "openingMomo", "closingCash", "closingMomo"].every((k) => isBlank(fields[k]));
  if (nothingYet) problems.push("an opening balance or a closing count");
  // The first ever opening has to include both, so the books start from a complete picture.
  if (!hasAnyOpening && (isBlank(fields.openingCash) || isBlank(fields.openingMomo))) problems.push("the opening balance for both cash and MoMo");

  const save = async () => {
    if (problems.length) return;
    setBusy(true);
    try {
      const num = (v) => (isBlank(v) ? null : Number(v));
      await saveCashBookDay({
        day: date,
        openingCash: num(fields.openingCash), openingMomo: num(fields.openingMomo),
        closingCash: num(fields.closingCash), closingMomo: num(fields.closingMomo),
        note: fields.note.trim(),
      }, session);
      setForm({});
      setSaved("Saved.");
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't save — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const show = row || { openingCash: 0, openingMomo: 0, cashIn: 0, momoIn: 0, cardIn: 0, expectedCash: 0, expectedMomo: 0 };
  const cell = "border border-[var(--basalt)]/15 rounded px-2 py-1.5 text-sm bg-white text-right w-36";

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Cash &amp; MoMo — opening and closing balance</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">
          Enter the money you have at the start of the day (the first time, what you had before the system was introduced), and count it again at the end.
          The system works out what the closing balance <i>should</i> be from the day's payments, so any difference stands out.
          If you don't enter an opening, it carries on from the day before.
        </p>
        {!hasAnyOpening && (
          <p className="text-xs mb-3 px-3 py-2 rounded" style={{ background: "rgba(184,146,63,0.15)" }}>
            Start here: pick the day you want the books to begin and enter the cash and MoMo you had at that moment as the opening balance.
          </p>
        )}
        <div className="flex flex-wrap gap-3 items-end">
          <div><label className="text-xs text-[var(--basalt)]/60">Day</label><Input type="date" value={date} max={dayStr(new Date())} onChange={(e) => changeDate(e.target.value)} className="max-w-[170px]" /></div>
        </div>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
                <th className="py-2 pr-3"></th><th className="py-2 pr-3 text-right">Cash</th><th className="py-2 pr-3 text-right">MoMo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3">Opening balance<div className="text-xs text-[var(--basalt)]/50">{entry?.openingCash != null || entry?.openingMomo != null ? "entered" : hasAnyOpening ? `carried from the day before: cash RWF ${fmt(show.openingCash)}, MoMo RWF ${fmt(show.openingMomo)}` : "not entered yet"}</div></td>
                <td className="py-2 pr-3 text-right"><input type="text" inputMode="decimal" className={cell} value={fields.openingCash} onChange={set("openingCash")} placeholder={hasAnyOpening ? String(show.openingCash) : "0"} /></td>
                <td className="py-2 pr-3 text-right"><input type="text" inputMode="decimal" className={cell} value={fields.openingMomo} onChange={set("openingMomo")} placeholder={hasAnyOpening ? String(show.openingMomo) : "0"} /></td>
              </tr>
              <tr className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3">Received today from bills</td>
                <td className="py-2 pr-3 text-right font-mono text-xs">RWF {fmt(show.cashIn)}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs">RWF {fmt(show.momoIn)}</td>
              </tr>
              <tr className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3 font-medium">System expects at closing</td>
                <td className="py-2 pr-3 text-right font-mono text-xs font-semibold">RWF {fmt(show.expectedCash)}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs font-semibold">RWF {fmt(show.expectedMomo)}</td>
              </tr>
              <tr className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3">Closing balance counted</td>
                <td className="py-2 pr-3 text-right"><input type="text" inputMode="decimal" className={cell} value={fields.closingCash} onChange={set("closingCash")} placeholder="count at the end of the day" /></td>
                <td className="py-2 pr-3 text-right"><input type="text" inputMode="decimal" className={cell} value={fields.closingMomo} onChange={set("closingMomo")} placeholder="count at the end of the day" /></td>
              </tr>
              <tr>
                <td className="py-2 pr-3 font-medium">Difference</td>
                <td className="py-2 pr-3 text-right font-mono text-xs font-semibold" style={{ color: diffColor(row?.diffCash) }}>{diffText(row?.diffCash)}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs font-semibold" style={{ color: diffColor(row?.diffMomo) }}>{diffText(row?.diffMomo)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {show.cardIn > 0 && <p className="text-xs text-[var(--basalt)]/50 mt-2">Card payments (RWF {fmt(show.cardIn)}) are not in cash or MoMo, so they aren't counted here.</p>}

        <div className="mt-3">
          <label className="text-xs text-[var(--basalt)]/60">Note (optional — e.g. why there is a difference)</label>
          <Input value={fields.note} onChange={set("note")} />
        </div>
        <MissingHint items={[...new Set(problems)]} className="mt-2" />
        <div className="flex items-center gap-3 mt-3">
          <PrimaryBtn color="var(--moss)" disabled={busy || problems.length > 0} onClick={save}><Save size={14} /> {busy ? "Saving…" : "Save"}</PrimaryBtn>
          {saved && <span className="text-sm" style={{ color: "var(--moss)" }}>{saved}</span>}
        </div>
      </Card>

      {rows.length > 0 && (
        <Card>
          <SectionLabel>Day by day</SectionLabel>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
                  <th className="py-2 pr-3">Day</th><th className="py-2 pr-3">Opening cash</th><th className="py-2 pr-3">Opening MoMo</th>
                  <th className="py-2 pr-3">Expected cash</th><th className="py-2 pr-3">Counted cash</th><th className="py-2 pr-3">Diff</th>
                  <th className="py-2 pr-3">Expected MoMo</th><th className="py-2 pr-3">Counted MoMo</th><th className="py-2 pr-3">Diff</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().slice(0, 31).map((r) => (
                  <tr key={r.day} className="border-b border-[var(--basalt)]/5 cursor-pointer hover:bg-[var(--basalt)]/[0.03]" onClick={() => changeDate(r.day)}>
                    <td className="py-2 pr-3">{new Date(r.day + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmt(r.openingCash)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmt(r.openingMomo)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmt(r.expectedCash)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.countedCash == null ? "—" : fmt(r.countedCash)}</td>
                    <td className="py-2 pr-3 font-mono text-xs" style={{ color: diffColor(r.diffCash) }}>{diffText(r.diffCash)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmt(r.expectedMomo)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.countedMomo == null ? "—" : fmt(r.countedMomo)}</td>
                    <td className="py-2 pr-3 font-mono text-xs" style={{ color: diffColor(r.diffMomo) }}>{diffText(r.diffMomo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
