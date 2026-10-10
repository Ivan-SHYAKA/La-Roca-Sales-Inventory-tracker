import { isReversal } from "../lib/stockMath";
import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, ListChecks, Info } from "lucide-react";
import { Card, SectionLabel } from "./ui";
import { OrderDetailsModal } from "./OrderDetails";
import { fmt, orderLabel } from "../lib/format";

const ymd = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const onDay = (iso, day) => !!iso && ymd(iso) === day;

// Built entirely from data already loaded for this session (orders + stock events are
// already scoped to what this role's RLS policies allow) — no separate fetch needed.
// "Mine" means this person is the one recorded as having performed the action, not just
// that the order is visible to their role.
export function ActivityLog({ orders, stockEvents, inventory, session }) {
  const [day, setDay] = useState(ymd(new Date()));
  const today = ymd(new Date());
  const [detailsOrder, setDetailsOrder] = useState(null);
  const [detailsStockEvent, setDetailsStockEvent] = useState(null);

  const invMap = useMemo(() => Object.fromEntries((inventory || []).map((i) => [i.id, i])), [inventory]);

  const items = useMemo(() => {
    const list = [];
    (orders || []).forEach((o) => {
      const who = orderLabel(o);
      const summary = o.items.map((it) => `${it.qty}× ${it.name}`).join(", ");
      if (o.placedById === session.id && onDay(o.placedAt, day)) list.push({ id: o.id + "-placed", time: o.placedAt, text: `Placed order for ${who}`, detail: summary, order: o });
      if (o.readyById === session.id && onDay(o.readyAt, day)) list.push({ id: o.id + "-ready", time: o.readyAt, text: `Marked ${who}'s order ready`, detail: summary, order: o });
      if (o.servedById === session.id && onDay(o.servedAt, day)) list.push({ id: o.id + "-served", time: o.servedAt, text: `Served ${who}`, detail: summary, order: o });
      if (o.billedById === session.id && onDay(o.billedAt, day)) list.push({ id: o.id + "-billed", time: o.billedAt, text: `Billed ${who} — RWF ${fmt(o.total)}`, order: o });
      if (o.cancelledById === session.id && onDay(o.cancelledAt, day)) list.push({ id: o.id + "-cancelled", time: o.cancelledAt, text: `Cancelled order for ${who}`, detail: o.cancelReason, order: o });
    });
    (stockEvents || []).forEach((e) => {
      if (e.userId === session.id && onDay(e.date, day)) {
        const invName = invMap[e.invId]?.name || "—";
        list.push({ id: e.id + "-stock", time: e.date, text: isReversal(e) ? `Corrected ${e.reason === "restock" ? "stock in" : "stock out (" + e.reason + ")"} — ${invName}: -${e.quantity}` : `Logged stock ${e.type === "in" ? "in" : "out"} — ${invName}: ${e.quantity} (${e.reason})`, detail: e.note, stockEvent: e });
      }
    });
    return list.sort((a, b) => new Date(b.time) - new Date(a.time));
  }, [orders, stockEvents, invMap, session.id, day]);

  const shift = (delta) => {
    const d = new Date(day + "T00:00:00");
    d.setDate(d.getDate() + delta);
    setDay(ymd(d));
  };

  return (
    <Card>
      {detailsOrder && <OrderDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />}
      {detailsStockEvent && <StockEventDetailsModal event={detailsStockEvent} inventory={invMap[detailsStockEvent.invId]} onClose={() => setDetailsStockEvent(null)} />}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <SectionLabel>My activity</SectionLabel>
        <div className="flex items-center gap-2">
          <button onClick={() => shift(-1)} className="p-1.5 rounded border border-[var(--basalt)]/15" aria-label="Previous day"><ChevronLeft size={14} /></button>
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)}
            className="border border-[var(--basalt)]/15 rounded px-2 py-1 text-sm bg-white" />
          <button onClick={() => shift(1)} disabled={day === today} className="p-1.5 rounded border border-[var(--basalt)]/15 disabled:opacity-30" aria-label="Next day"><ChevronRight size={14} /></button>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--basalt)]/50 flex items-center gap-2"><ListChecks size={16} /> No activity logged for this day.</p>
      ) : (
        <div className="space-y-3">
          {items.map((it) => (
            <button key={it.id} onClick={() => it.order ? setDetailsOrder(it.order) : setDetailsStockEvent(it.stockEvent)}
              className="w-full text-left text-sm border-b border-[var(--basalt)]/5 pb-2 last:border-0 last:pb-0 hover:bg-[var(--basalt)]/[0.03] -mx-1 px-1 rounded">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium flex items-center gap-1">{it.text} <Info size={11} className="text-[var(--basalt)]/30 shrink-0" /></span>
                <span className="text-xs text-[var(--basalt)]/40 font-mono shrink-0">{new Date(it.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              {it.detail && <div className="text-xs text-[var(--basalt)]/50 mt-0.5">{it.detail}</div>}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

function StockEventDetailsModal({ event, inventory, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <SectionLabel>Stock {event.type === "in" ? "in" : "out"} — {inventory?.name || "—"}</SectionLabel>
        <div className="text-sm space-y-1.5 mt-2">
          <div className="flex justify-between"><span className="text-[var(--basalt)]/60">Quantity</span><span className="font-mono">{event.quantity} {inventory?.unit || ""}</span></div>
          <div className="flex justify-between"><span className="text-[var(--basalt)]/60">Reason</span><span>{event.reason}</span></div>
          <div className="flex justify-between"><span className="text-[var(--basalt)]/60">Date</span><span>{new Date(event.date).toLocaleString()}</span></div>
          {event.note && <div className="pt-1 border-t border-[var(--basalt)]/10 mt-1"><span className="text-[var(--basalt)]/60">Note: </span>{event.note}</div>}
        </div>
        <div className="flex justify-end mt-4"><button onClick={onClose} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Close</button></div>
      </Card>
    </div>
  );
}
