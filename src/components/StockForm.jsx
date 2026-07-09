import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { Card, SectionLabel, Input, Select, PrimaryBtn } from "./ui";
import { LINES } from "../lib/constants";
import { draftGet, draftSet, draftClear } from "../lib/draft";
import { logStockEvent } from "../lib/data";

export function StockForm({ mode, inventory, stockEvents, session, refresh, onError }) {
  const isIn = mode === "in";
  const draftKey = `lr-draft-stock-${mode}-${session.username}`;
  const [existingId, setExistingId] = useState("");
  const [newItem, setNewItem] = useState({ name: "", line: "restaurant", unit: "kg", reorderLevel: "", costPerUnit: "" });
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("usage");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = draftGet(draftKey);
    if (d) {
      setExistingId(d.existingId || ""); setNewItem(d.newItem || newItem); setQuantity(d.quantity || ""); setReason(d.reason || "usage"); setNote(d.note || "");
    }
  }, []);
  useEffect(() => { draftSet(draftKey, { existingId, newItem, quantity, reason, note }); }, [existingId, newItem, quantity, reason, note]);

  const submit = async () => {
    const qty = Number(quantity);
    if (!qty || qty <= 0) return;
    if (!existingId && !newItem.name) return;
    setBusy(true);
    try {
      await logStockEvent({ mode, existingId, newItem, quantity: qty, reason, note, session });
      setExistingId(""); setQuantity(""); setNote(""); setNewItem({ ...newItem, name: "" }); draftClear(draftKey);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't log the stock event — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const recent = stockEvents.filter((e) => e.type === mode).slice(0, 15);
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>{isIn ? "Record stock coming in" : "Record stock going out"}</SectionLabel>
        <label className="text-xs text-[var(--basalt)]/60">Item</label>
        <Select value={existingId} onChange={(e) => setExistingId(e.target.value)}>
          <option value="">{isIn ? "— New item —" : "Select existing item"}</option>
          {inventory.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} in stock)</option>)}
        </Select>
        {!existingId && isIn && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div><label className="text-xs text-[var(--basalt)]/60">Name</label><Input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} /></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Line</label><Select value={newItem.line} onChange={(e) => setNewItem({ ...newItem, line: e.target.value })}>{Object.entries(LINES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Unit</label><Input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} /></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Reorder at</label><Input type="number" value={newItem.reorderLevel} onChange={(e) => setNewItem({ ...newItem, reorderLevel: e.target.value })} /></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Cost/unit (RWF)</label><Input type="number" value={newItem.costPerUnit} onChange={(e) => setNewItem({ ...newItem, costPerUnit: e.target.value })} /></div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          <div><label className="text-xs text-[var(--basalt)]/60">Quantity</label><Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          {!isIn && (
            <div><label className="text-xs text-[var(--basalt)]/60">Reason</label>
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="usage">Used in an order (kitchen usage)</option>
                <option value="waste">Waste</option>
                <option value="spoilage">Spoilage</option>
                <option value="other">Other</option>
              </Select>
            </div>
          )}
          <div><label className="text-xs text-[var(--basalt)]/60">Note (optional)</label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <div className="flex justify-end mt-4"><PrimaryBtn color={isIn ? "var(--moss)" : "var(--ember)"} disabled={busy} onClick={submit}><Plus size={15} /> {isIn ? "Log stock-in" : "Log stock-out"}</PrimaryBtn></div>
        {!isIn && <p className="text-xs text-[var(--basalt)]/50 mt-2">Tagging "Used in an order" lets the manager dashboard reconcile it against what recipes say should've been used — that's the check against misuse or theft.</p>}
      </Card>

      <Card>
        <SectionLabel>Recent {isIn ? "stock-in" : "stock-out"} events</SectionLabel>
        {recent.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">Nothing logged yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Qty</th>{!isIn && <th className="py-2 pr-3">Reason</th>}<th className="py-2 pr-3">By</th><th className="py-2 pr-3">When</th></tr></thead>
            <tbody>{recent.map((e) => (
              <tr key={e.id} className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3">{invMap[e.invId]?.name || "—"}</td>
                <td className="py-2 pr-3 font-mono text-xs">{e.quantity} {invMap[e.invId]?.unit}</td>
                {!isIn && <td className="py-2 pr-3 text-xs">{e.reason}</td>}
                <td className="py-2 pr-3 text-xs">{e.user}</td>
                <td className="py-2 pr-3 text-xs text-[var(--basalt)]/50">{new Date(e.date).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
