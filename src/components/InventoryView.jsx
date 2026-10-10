import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Pencil } from "lucide-react";
import { Card, SectionLabel, Badge, Input, PrimaryBtn } from "./ui";
import { updateInventoryItems } from "../lib/data";
import { isBlank, isNonNegative } from "../lib/validate";
import { UNITS } from "../lib/dailySheet";
import { LINES } from "../lib/constants";
import { reconciliation } from "../lib/business";
import { fmt } from "../lib/format";

export function InventoryView({ inventory, orders, menu, stockEvents, canEdit = false, refresh, onError }) {
  const [lineFilter, setLineFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Edit mode: names, units, headings, reorder levels and prices in one table, saved together.
  // Quantities are not editable here: they only ever change through stock entries.
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const setDraft = (id, key, value) => setDrafts((d) => ({ ...d, [id]: { ...(d[id] || {}), [key]: value } }));
  const categories = useMemo(() => [...new Set(inventory.map((i) => i.category).filter(Boolean))].sort(), [inventory]);
  const dirtyIds = Object.keys(drafts).filter((id) => {
    const item = inventory.find((i) => i.id === id);
    return item && Object.entries(drafts[id]).some(([k, v]) => String(v) !== String(item[k] ?? ""));
  });
  // Name and units can't be emptied; reorder level and cost must be numbers of 0 or more.
  const draftProblems = dirtyIds.flatMap((id) => {
    const item = inventory.find((i) => i.id === id);
    const d = { ...item, ...drafts[id] };
    const bad = [];
    if (isBlank(d.name)) bad.push("a name");
    if (isBlank(d.unit)) bad.push("units");
    if (!isNonNegative(d.reorderLevel)) bad.push("a reorder level of 0 or more");
    if (!isNonNegative(d.costPerUnit)) bad.push("a cost of 0 or more");
    return bad.length ? [`${item.name || "An item"}: ${bad.join(", ")}`] : [];
  });
  const saveDrafts = async () => {
    if (draftProblems.length) return;
    setBusy(true);
    try {
      await updateInventoryItems(dirtyIds.map((id) => ({ ...inventory.find((i) => i.id === id), ...drafts[id], id })));
      setDrafts({});
      setEditing(false);
      await refresh?.();
    } catch (e) {
      onError?.(e.message || "Couldn't save the changes.");
    } finally {
      setBusy(false);
    }
  };
  const recon = reconciliation(inventory, orders, menu, stockEvents, 30);

  const countByLine = useMemo(() => {
    const c = {};
    inventory.forEach((i) => { c[i.line] = (c[i.line] || 0) + 1; });
    return c;
  }, [inventory]);

  const visibleInventory = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = inventory.filter((i) => (lineFilter === "all" || i.line === lineFilter) && (!q || i.name.toLowerCase().includes(q)));
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory, lineFilter, search]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Inventory</SectionLabel>
        <div className="flex flex-wrap gap-2 mb-3">
          <button onClick={() => setLineFilter("all")}
            className="text-xs px-3 py-1.5 rounded-full font-medium border"
            style={lineFilter === "all"
              ? { background: "var(--basalt)", color: "white", borderColor: "var(--basalt)" }
              : { background: "transparent", color: "var(--basalt)", borderColor: "rgba(38,34,29,0.15)" }}>
            All ({inventory.length})
          </button>
          {Object.entries(LINES).map(([key, l]) => (
            <button key={key} onClick={() => setLineFilter(key)}
              className="text-xs px-3 py-1.5 rounded-full font-medium border"
              style={lineFilter === key
                ? { background: l.color, color: "white", borderColor: l.color }
                : { background: l.color + "11", color: l.color, borderColor: l.color + "44" }}>
              {l.label} ({countByLine[key] || 0})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inventory…" className="max-w-xs !mt-0" />
          {canEdit && !editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm border border-[var(--basalt)]/20"><Pencil size={13} /> Edit prices and details</button>
          )}
          {editing && (
            <>
              <PrimaryBtn color="var(--moss)" disabled={busy || dirtyIds.length === 0 || draftProblems.length > 0} onClick={saveDrafts}>{busy ? "Saving…" : `Save ${dirtyIds.length} change${dirtyIds.length === 1 ? "" : "s"}`}</PrimaryBtn>
              <button onClick={() => { setEditing(false); setDrafts({}); }} className="px-3 py-1.5 rounded text-sm border border-[var(--basalt)]/20">Cancel</button>
              <span className="text-xs text-[var(--basalt)]/50">Cost per unit is what the item costs you to buy; profit and loss use it.</span>
              {draftProblems.length > 0 && <span className="text-xs w-full" style={{ color: "var(--ember)" }}>Needed before saving: {draftProblems.slice(0, 3).join("; ")}{draftProblems.length > 3 ? ` and ${draftProblems.length - 3} more` : ""}.</span>}
            </>
          )}
        </div>
        {visibleInventory.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">No items yet.</p> : editing ? (
          <div className="overflow-x-auto">
            <datalist id="inv-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <table className="w-full text-sm min-w-[820px]">
              <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
                <th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Heading</th><th className="py-2 pr-2">Units</th><th className="py-2 pr-2">Used by</th>
                <th className="py-2 pr-2">Tell me at</th><th className="py-2 pr-2">Cost / unit (RWF)</th><th className="py-2 pr-2">Now</th>
              </tr></thead>
              <tbody>
                {visibleInventory.map((i) => {
                  const d = drafts[i.id] || {};
                  const v = (k) => (d[k] !== undefined ? d[k] : (i[k] ?? ""));
                  const cell = "border border-[var(--basalt)]/15 rounded px-1.5 py-1 text-sm bg-white w-full";
                  return (
                    <tr key={i.id} className="border-b border-[var(--basalt)]/5" style={{ background: dirtyIds.includes(i.id) ? "rgba(70,88,63,0.10)" : "transparent" }}>
                      <td className="py-1 pr-2"><input className={cell} value={v("name")} onChange={(e) => setDraft(i.id, "name", e.target.value)} /></td>
                      <td className="py-1 pr-2"><input className={cell} list="inv-categories" value={v("category")} onChange={(e) => setDraft(i.id, "category", e.target.value)} /></td>
                      <td className="py-1 pr-2"><select className={cell} value={v("unit")} onChange={(e) => setDraft(i.id, "unit", e.target.value)}>
                        {[...new Set([...UNITS, i.unit])].map((u) => <option key={u} value={u}>{u}</option>)}</select></td>
                      <td className="py-1 pr-2"><select className={cell} value={v("line")} onChange={(e) => setDraft(i.id, "line", e.target.value)}>
                        {Object.entries(LINES).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}</select></td>
                      <td className="py-1 pr-2 w-24"><input className={cell + " text-right"} type="number" min="0" value={v("reorderLevel")} onChange={(e) => setDraft(i.id, "reorderLevel", e.target.value)} /></td>
                      <td className="py-1 pr-2 w-32"><input className={cell + " text-right"} type="number" min="0" value={v("costPerUnit")} onChange={(e) => setDraft(i.id, "costPerUnit", e.target.value)} /></td>
                      <td className="py-1 pr-2 font-mono text-xs">{i.quantity} {i.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Line</th><th className="py-2 pr-3">Quantity</th><th className="py-2 pr-3">Reorder at</th><th className="py-2 pr-3">Value</th></tr></thead>
            <tbody>
              {visibleInventory.map((i) => {
                const low = i.quantity <= i.reorderLevel;
                return (
                  <tr key={i.id} className="border-b border-[var(--basalt)]/5" style={{ background: low ? "rgba(181,74,40,0.06)" : "transparent" }}>
                    <td className="py-2 pr-3">{i.name}</td>
                    <td className="py-2 pr-3"><Badge color={LINES[i.line].color}>{LINES[i.line].label}</Badge></td>
                    <td className="py-2 pr-3 font-mono text-xs" style={{ color: low ? "var(--ember)" : "inherit", fontWeight: low ? 600 : 400 }}>{i.quantity} {i.unit} {low && <AlertTriangle size={12} className="inline ml-1" color="var(--ember)" />}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{i.reorderLevel} {i.unit}</td>
                    <td className="py-2 pr-3 font-mono text-xs">RWF {fmt(i.quantity * i.costPerUnit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <SectionLabel>Usage reconciliation — last 30 days</SectionLabel>
        {recon.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">No recipe-linked activity yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Expected</th><th className="py-2 pr-3">Actual</th><th className="py-2 pr-3">Variance</th></tr></thead>
            <tbody>{recon.map((r) => (
              <tr key={r.name} className="border-b border-[var(--basalt)]/5" style={{ background: r.flagged ? "rgba(181,74,40,0.06)" : "transparent" }}>
                <td className="py-2 pr-3">{r.name}</td><td className="py-2 pr-3 font-mono text-xs">{r.expected.toFixed(1)} {r.unit}</td>
                <td className="py-2 pr-3 font-mono text-xs">{r.actual.toFixed(1)} {r.unit}</td>
                <td className="py-2 pr-3 font-mono text-xs" style={{ color: r.flagged ? "var(--ember)" : "inherit" }}>{r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)} {r.unit}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
