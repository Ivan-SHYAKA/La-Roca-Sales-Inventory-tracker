import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { Card, SectionLabel, Input, Select, PrimaryBtn, Req, MissingHint } from "./ui";
import { isBlank, isPositive, isNonNegative } from "../lib/validate";
import { UNITS } from "../lib/dailySheet";
import { ItemPicker } from "./ItemPicker";
import { LINES } from "../lib/constants";
import { draftGet, draftSet, draftClear } from "../lib/draft";
import { logStockEvent } from "../lib/data";
import { orderLabel, fmt } from "../lib/format";
import { isReversal } from "../lib/stockMath";

export function StockForm({ mode, inventory, stockEvents, orders = [], session, refresh, onError }) {
  const isIn = mode === "in";
  const draftKey = `lr-draft-stock-${mode}-${session.username}`;
  const [existingId, setExistingId] = useState("");
  const [newItem, setNewItem] = useState({ name: "", line: "restaurant", category: "", unit: "Kg", reorderLevel: "", costPerUnit: "" });
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("usage");
  const [note, setNote] = useState("");
  const [orderId, setOrderId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = draftGet(draftKey);
    if (d) {
      setExistingId(d.existingId || ""); setNewItem(d.newItem || newItem); setQuantity(d.quantity || ""); setReason(d.reason || "usage"); setNote(d.note || ""); setOrderId(d.orderId || "");
    }
  }, []);
  useEffect(() => { draftSet(draftKey, { existingId, newItem, quantity, reason, note, orderId }); }, [existingId, newItem, quantity, reason, note, orderId]);

  // What's still needed. A new item must have a name, heading and units; waste, spoilage and
  // "other" need a note saying what happened (that's what the manager reads afterwards).
  const problems = [];
  if (!existingId && !isIn) problems.push("the item");
  if (!existingId && isIn) {
    if (isBlank(newItem.name)) problems.push("the item (pick one, or fill in a new item's name)");
    if (isBlank(newItem.category)) problems.push("the new item's heading");
    if (isBlank(newItem.unit)) problems.push("the new item's units");
  }
  if (!isPositive(quantity)) problems.push("quantity (more than 0)");
  if (!isIn && reason !== "usage" && isBlank(note)) problems.push("a note saying what happened");
  if (isIn && !existingId && !isBlank(newItem.reorderLevel) && !isNonNegative(newItem.reorderLevel)) problems.push("a reorder level of 0 or more");

  const submit = async () => {
    const qty = Number(quantity);
    if (problems.length) return;
    if (!isIn && existingId) {
      const available = invMap[existingId]?.quantity ?? 0;
      if (qty > available) {
        onError?.(`Only ${available} ${invMap[existingId]?.unit || ""} of ${invMap[existingId]?.name} left in stock — can't log ${qty} out.`);
        return;
      }
    }
    setBusy(true);
    try {
      await logStockEvent({ mode, existingId, newItem, quantity: qty, reason, note, session, orderId: orderId || null });
      setExistingId(""); setQuantity(""); setNote(""); setOrderId(""); setNewItem({ ...newItem, name: "" }); draftClear(draftKey);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't log the stock event — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const recent = stockEvents.filter((e) => e.type === mode && !isReversal(e)).slice(0, 15);
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));
  const orderMap = Object.fromEntries(orders.map((o) => [o.id, o]));
  // Only "usage" stock-out has a specific order behind it — waste/spoilage/missing/other don't.
  const linkableOrders = orders.filter((o) => ["placed", "ready", "served"].includes(o.status) && (!existingId || o.line === invMap[existingId]?.line));

  const categories = [...new Set(inventory.map((i) => i.category).filter(Boolean))].sort();
  return (
    <div className="space-y-6">
      <datalist id="stock-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <Card>
        <SectionLabel>{isIn ? "Record stock coming in" : "Record stock going out"}</SectionLabel>
        <label className="text-xs text-[var(--basalt)]/60">Item{!isIn && <Req />}</label>
        <ItemPicker
          items={inventory}
          value={existingId}
          onChange={setExistingId}
          getLabel={(i) => `${i.name} (${i.quantity} ${i.unit} in stock)`}
          placeholder={isIn ? "Search item, or leave blank for a new one…" : "Search item…"}
        />
        {!existingId && isIn && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div><label className="text-xs text-[var(--basalt)]/60">Name<Req /></label><Input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} /></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Line</label><Select value={newItem.line} onChange={(e) => setNewItem({ ...newItem, line: e.target.value })}>{Object.entries(LINES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Heading<Req /></label><Input list="stock-categories" value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} /></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Unit<Req /></label><Select value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}>{UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Reorder at</label><Input type="number" value={newItem.reorderLevel} onChange={(e) => setNewItem({ ...newItem, reorderLevel: e.target.value })} /></div>
            <div><label className="text-xs text-[var(--basalt)]/60">Cost/unit (RWF)</label><Input type="number" value={newItem.costPerUnit} onChange={(e) => setNewItem({ ...newItem, costPerUnit: e.target.value })} /></div>
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
          <div>
            <label className="text-xs text-[var(--basalt)]/60">Quantity<Req /></label>
            <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} max={!isIn && existingId ? invMap[existingId]?.quantity : undefined} />
            {!isIn && existingId && <p className="text-xs text-[var(--basalt)]/40 mt-0.5">{invMap[existingId]?.quantity} {invMap[existingId]?.unit} available</p>}
            {existingId && isPositive(quantity) && (
              invMap[existingId]?.costPerUnit > 0
                ? <p className="text-xs mt-0.5" style={{ color: "var(--moss)" }}>Value: RWF {fmt(Number(quantity) * invMap[existingId].costPerUnit)} (at RWF {fmt(invMap[existingId].costPerUnit)} per {invMap[existingId].unit})</p>
                : <p className="text-xs text-[var(--basalt)]/40 mt-0.5">No cost per unit set yet, so no value to show. Set it in Inventory → Edit prices and details.</p>
            )}
          </div>
          {!isIn && (
            <div><label className="text-xs text-[var(--basalt)]/60">Reason<Req /></label>
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="usage">Used in an order (kitchen usage)</option>
                <option value="waste">Waste</option>
                <option value="spoilage">Spoilage</option>
                <option value="other">Other</option>
              </Select>
            </div>
          )}
          <div><label className="text-xs text-[var(--basalt)]/60">{!isIn && reason !== "usage" ? <>Note<Req /></> : "Note (optional)"}</label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        {!isIn && reason === "usage" && (
          <div className="mt-3">
            <label className="text-xs text-[var(--basalt)]/60">Link to order (optional)</label>
            <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">— Not tied to a specific order —</option>
              {linkableOrders.map((o) => <option key={o.id} value={o.id}>{orderLabel(o)}</option>)}
            </Select>
          </div>
        )}
        <div className="flex justify-end mt-4"><PrimaryBtn color={isIn ? "var(--moss)" : "var(--ember)"} disabled={busy || problems.length > 0} onClick={submit}><Plus size={15} /> {isIn ? "Log stock-in" : "Log stock-out"}</PrimaryBtn></div>
        <MissingHint items={problems} className="mt-2 text-right" />
        {!isIn && <p className="text-xs text-[var(--basalt)]/50 mt-2">Tagging "Used in an order" lets the manager dashboard reconcile it against what recipes say should've been used — that's the check against misuse or theft.</p>}
      </Card>

      <Card>
        <SectionLabel>Recent {isIn ? "stock-in" : "stock-out"} events</SectionLabel>
        {recent.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">Nothing logged yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Qty</th>{!isIn && <th className="py-2 pr-3">Reason</th>}{!isIn && <th className="py-2 pr-3">Order</th>}<th className="py-2 pr-3">Price (RWF)</th><th className="py-2 pr-3">By</th><th className="py-2 pr-3">When</th></tr></thead>
            <tbody>{recent.map((e) => (
              <tr key={e.id} className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3">{invMap[e.invId]?.name || "—"}</td>
                <td className="py-2 pr-3 font-mono text-xs">{e.quantity} {invMap[e.invId]?.unit}</td>
                {!isIn && <td className="py-2 pr-3 text-xs">{e.reason}</td>}
                {!isIn && <td className="py-2 pr-3 text-xs">{e.orderId && orderMap[e.orderId] ? orderLabel(orderMap[e.orderId]) : "—"}</td>}
                <td className="py-2 pr-3 font-mono text-xs">{invMap[e.invId]?.costPerUnit > 0 ? fmt(e.quantity * invMap[e.invId].costPerUnit) : "—"}</td>
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
