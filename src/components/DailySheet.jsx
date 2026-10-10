import { useMemo, useRef, useState } from "react";
import { Download, Plus, Save, AlertTriangle } from "lucide-react";
import { Card, SectionLabel, Input, Select, PrimaryBtn } from "./ui";
import { buildSheet, evaluateRow, eventsForRow, sortInFirst, stampFor, UNITS, CATEGORY_ORDER, NO_CATEGORY } from "../lib/dailySheet";
import { logStockEvents, createInventoryItem } from "../lib/data";
import { LINES } from "../lib/constants";
import { toCsv, downloadCsv } from "../lib/csv";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const show = (n) => (n ? String(n) : "");

// The storekeeper's Excel sheet, on screen: every item under its heading, Opening filled in
// for them, and a cell each for In / Out / Missing / Spoiled / Justification. Closing works
// itself out. Nothing is sent until "Save sheet" — then it all goes in together.
export function DailySheet({ inventory, stockEvents, session, refresh, onError }) {
  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [adding, setAdding] = useState(false);
  const wrapRef = useRef(null);

  const sheet = useMemo(() => buildSheet(inventory, stockEvents, date), [inventory, stockEvents, date]);
  const evaluated = useMemo(() => {
    const out = {};
    sheet.forEach(([, rows]) => rows.forEach((r) => { out[r.id] = evaluateRow(r, edits[r.id]); }));
    return out;
  }, [sheet, edits]);

  // A row counts as touched when a quantity differs from what's recorded, or a note was typed.
  const touchedIds = Object.keys(edits).filter((id) => evaluated[id] && (evaluated[id].changed || edits[id].note !== undefined));
  const problems = touchedIds.filter((id) => evaluated[id].problem);
  const readyIds = touchedIds.filter((id) => evaluated[id].changed && !evaluated[id].problem);
  const isPast = date !== todayStr();

  const q = search.trim().toLowerCase();
  const visible = sheet
    .map(([cat, rows]) => [cat, q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows])
    .filter(([, rows]) => rows.length > 0);

  const setCell = (id, key, value) => {
    setSaved("");
    setEdits((cur) => ({ ...cur, [id]: { ...(cur[id] || {}), [key]: value } }));
  };

  // Enter moves down to the same column in the next row, like Excel.
  const onKeyDown = (e, rowIdx, col) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const next = wrapRef.current?.querySelector(`[data-cell="${col}-${rowIdx + 1}"]`);
    if (next) { next.focus(); next.select?.(); }
  };

  const save = async () => {
    if (problems.length) { onError?.("Some rows need attention before the sheet can be saved — they're marked in red."); return; }
    const when = stampFor(date);
    const rowsById = {};
    sheet.forEach(([, rows]) => rows.forEach((r) => { rowsById[r.id] = r; }));
    const events = sortInFirst(readyIds.flatMap((id) => eventsForRow(rowsById[id], evaluated[id], when)));
    if (!events.length) return;
    setBusy(true);
    try {
      await logStockEvents(events, session);
      setEdits((cur) => { const n = { ...cur }; readyIds.forEach((id) => delete n[id]); return n; });
      setSaved(`Saved ${readyIds.length} item${readyIds.length === 1 ? "" : "s"}.`);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't save the sheet — nothing was changed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const rows = sheet.flatMap(([cat, items]) => items.map((r) => ({ ...r, cat })));
    downloadCsv(`daily-sheet-${date}.csv`, toCsv(rows, [
      { label: "Category", get: (r) => r.cat }, { label: "Item", get: (r) => r.name }, { label: "Units", get: (r) => r.unit },
      { label: "Opening", get: (r) => r.opening }, { label: "In", get: (r) => r.in }, { label: "Out", get: (r) => r.out },
      { label: "Closing", get: (r) => Math.round((r.opening + r.in - r.out) * 1000) / 1000 },
      { label: "Missing", get: (r) => r.missing }, { label: "Spoiled", get: (r) => r.spoiled }, { label: "Justification", get: (r) => r.note },
    ]));
  };

  let rowIdx = -1;
  const cellCls = "border border-[var(--basalt)]/15 rounded px-1.5 py-1 text-sm bg-white text-right w-16 sm:w-20";
  const head = "py-2 px-1 font-medium text-[var(--basalt)]/60";

  return (
    <div className="space-y-5" ref={wrapRef}>
      <Card>
        <SectionLabel>Daily sheet</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">
          The same sheet you know: <b>Opening</b> is filled in for you. Type what came <b>In</b> and what went <b>Out</b> —
          <b> Missing</b> and <b>Spoiled</b> are part of Out. <b>Closing</b> works itself out. Press <b>Save sheet</b> when you are done.
          You can save as often as you like in a day, and to fix a figure just type the right one.
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-[var(--basalt)]/60">Date</label>
            <Input type="date" value={date} max={todayStr()} className="max-w-[170px]"
              onChange={(e) => { if (e.target.value) { setDate(e.target.value); setEdits({}); setSaved(""); } }} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-[var(--basalt)]/60">Find an item</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type a name…" />
          </div>
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm border border-[var(--basalt)]/20"><Download size={14} /> Download for Excel</button>
          <button onClick={() => setAdding((a) => !a)} className="flex items-center gap-1.5 px-3 py-2 rounded text-sm border border-[var(--basalt)]/20"><Plus size={14} /> New item</button>
        </div>
        {isPast && (
          <p className="text-xs mt-3 px-3 py-2 rounded" style={{ background: "rgba(184,146,63,0.15)" }}>
            You are on the sheet for {new Date(date + "T12:00:00").toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}. Anything you save is recorded against that day.
          </p>
        )}
      </Card>

      {adding && <NewItemPanel sheet={sheet} session={session} onDone={async () => { setAdding(false); await refresh(); }} onError={onError} />}

      {visible.length === 0 && (
        <Card><p className="text-sm text-[var(--basalt)]/50">{inventory.length === 0 ? "No items yet — use New item to add the first one." : "Nothing matches that search."}</p></Card>
      )}

      {visible.map(([category, rows]) => (
        <Card key={category} className="!p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-xs bg-[var(--basalt)]/[0.04] border-b border-[var(--basalt)]/10">
                  <th className="py-2 px-3 font-semibold text-[var(--basalt)]">{category}</th>
                  <th className={head}>Units</th>
                  <th className={head + " text-right"}>Opening</th>
                  <th className={head + " text-right"}>In</th>
                  <th className={head + " text-right"}>Out</th>
                  <th className={head + " text-right px-2"}>Closing</th>
                  <th className={head + " text-right"}>Missing</th>
                  <th className={head + " text-right"}>Spoiled</th>
                  <th className={head + " px-2"}>Justification</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  rowIdx += 1;
                  const idx = rowIdx;
                  const ev = evaluated[r.id];
                  const edit = edits[r.id];
                  const touched = !!edit && (ev.changed || edit.note !== undefined);
                  const low = r.reorderLevel > 0 && ev.closing <= r.reorderLevel;
                  const field = (k) => (edit && edit[k] !== undefined ? edit[k] : show(r[k]));
                  const numCell = (k) => (
                    <input type="text" inputMode="decimal" data-cell={`${k}-${idx}`} value={field(k)} placeholder="0"
                      onChange={(e) => setCell(r.id, k, e.target.value)} onKeyDown={(e) => onKeyDown(e, idx, k)} onFocus={(e) => e.target.select()}
                      className={cellCls} style={ev.problem && touched ? { borderColor: "var(--ember)" } : undefined} />
                  );
                  return (
                    <tr key={r.id} className="border-b border-[var(--basalt)]/5"
                      style={{ background: touched ? (ev.problem ? "rgba(181,74,40,0.08)" : "rgba(70,88,63,0.10)") : "transparent" }}>
                      <td className="py-1.5 px-3">
                        <div>{r.name}</div>
                        {touched && ev.problem && <div className="text-xs mt-0.5" style={{ color: "var(--ember)" }}>{ev.problem}</div>}
                      </td>
                      <td className="py-1.5 px-1 text-xs text-[var(--basalt)]/60">{r.unit}</td>
                      <td className="py-1.5 px-1 text-right font-mono text-xs">{r.opening}</td>
                      <td className="py-1.5 px-1 text-right">{numCell("in")}</td>
                      <td className="py-1.5 px-1 text-right">{numCell("out")}</td>
                      <td className="py-1.5 px-2 text-right font-mono text-xs font-semibold" style={{ color: ev.closing < 0 || low ? "var(--ember)" : "inherit" }}>
                        {ev.closing}{low && <AlertTriangle size={11} className="inline ml-1" />}
                      </td>
                      <td className="py-1.5 px-1 text-right">{numCell("missing")}</td>
                      <td className="py-1.5 px-1 text-right">{numCell("spoiled")}</td>
                      <td className="py-1.5 px-2">
                        <input type="text" data-cell={`note-${idx}`} value={edit && edit.note !== undefined ? edit.note : r.note}
                          onChange={(e) => setCell(r.id, "note", e.target.value)} onKeyDown={(e) => onKeyDown(e, idx, "note")}
                          className="border border-[var(--basalt)]/15 rounded px-1.5 py-1 text-sm bg-white w-full min-w-[120px]" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <div className="sticky bottom-3 z-10">
        <Card className="flex flex-wrap items-center gap-3 !py-3" style={{ boxShadow: "0 4px 18px rgba(38,34,29,0.15)" }}>
          <div className="text-sm flex-1 min-w-[180px]">
            {touchedIds.length === 0
              ? (saved ? <span style={{ color: "var(--moss)" }}>{saved}</span> : <span className="text-[var(--basalt)]/60">No changes yet — type in the cells above.</span>)
              : (
                <span>
                  {readyIds.length} item{readyIds.length === 1 ? "" : "s"} ready to save
                  {problems.length > 0 && <span style={{ color: "var(--ember)" }}> · {problems.length} need{problems.length === 1 ? "s" : ""} attention</span>}
                </span>
              )}
          </div>
          {touchedIds.length > 0 && <button onClick={() => { setEdits({}); setSaved(""); }} className="px-3 py-2 rounded text-sm border border-[var(--basalt)]/20">Clear</button>}
          <PrimaryBtn color="var(--moss)" disabled={busy || readyIds.length === 0 || problems.length > 0} onClick={save}>
            <Save size={14} /> {busy ? "Saving…" : "Save sheet"}
          </PrimaryBtn>
        </Card>
      </div>
    </div>
  );
}

// An item the sheet doesn't have yet. Its heading and units are picked from what the sheet
// already uses; the line (restaurant / coffee shop) follows the heading unless changed.
function NewItemPanel({ sheet, session, onDone, onError }) {
  const categories = useMemo(() => {
    const names = sheet.map(([c]) => c).filter((c) => c !== NO_CATEGORY);
    return [...new Set([...CATEGORY_ORDER, ...names])];
  }, [sheet]);
  const lineByCategory = useMemo(() => {
    const m = {};
    sheet.forEach(([c, rows]) => { if (rows[0]?.line) m[c] = rows[0].line; });
    return m;
  }, [sheet]);
  const [f, setF] = useState({ name: "", category: categories[0] || "", unit: "Kg", line: "", reorderLevel: "", costPerUnit: "", quantity: "" });
  const [busy, setBusy] = useState(false);
  const line = f.line || lineByCategory[f.category] || "restaurant";

  const add = async () => {
    if (!f.name.trim()) return;
    setBusy(true);
    try {
      await createInventoryItem({ ...f, line, session });
      await onDone();
    } catch (e) {
      onError?.(e.message || "Couldn't add the item.");
    } finally {
      setBusy(false);
    }
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <SectionLabel>New item</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2"><label className="text-xs text-[var(--basalt)]/60">Name</label><Input value={f.name} onChange={set("name")} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Heading</label>
          <Select value={f.category} onChange={set("category")}>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</Select></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Units</label>
          <Select value={f.unit} onChange={set("unit")}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Quantity in store now</label><Input type="number" min="0" value={f.quantity} onChange={set("quantity")} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Tell me when it reaches</label><Input type="number" min="0" value={f.reorderLevel} onChange={set("reorderLevel")} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Cost per unit (RWF)</label><Input type="number" min="0" value={f.costPerUnit} onChange={set("costPerUnit")} /></div>
        <div><label className="text-xs text-[var(--basalt)]/60">Used by</label>
          <Select value={line} onChange={set("line")}>{Object.entries(LINES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
      </div>
      <PrimaryBtn color="var(--moss)" className="mt-4" disabled={busy || !f.name.trim()} onClick={add}><Plus size={14} /> {busy ? "Adding…" : "Add to the sheet"}</PrimaryBtn>
    </Card>
  );
}
