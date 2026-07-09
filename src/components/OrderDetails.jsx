import { Card, SectionLabel, Badge, StatusBadge } from "./ui";
import { LINES } from "../lib/constants";
import { fmt, orderLabel } from "../lib/format";

// Shared read-only order breakdown, usable from any screen that lists orders (billing,
// kitchen/barista queues, ready-to-serve, activity log) — not just after billing.
export function OrderDetailsModal({ order, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <SectionLabel>{orderLabel(order)}</SectionLabel>
          <Badge color={LINES[order.line].color}>{LINES[order.line].label}</Badge>
          <StatusBadge status={order.status} />
        </div>
        {order.client && order.tableNumber && <p className="text-xs text-[var(--basalt)]/50 mb-2">Client: {order.client}</p>}
        {order.phone && <p className="text-xs text-[var(--basalt)]/50 mb-2">Phone: {order.phone}</p>}
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-left border-b border-[var(--basalt)]/10 text-xs uppercase text-[var(--basalt)]/50"><th className="py-1">Item</th><th className="py-1">Qty</th><th className="py-1 text-right">Subtotal</th></tr></thead>
          <tbody>{order.items.map((it, i) => (
            <tr key={i}><td className="py-1">{it.name}</td><td className="py-1">{it.qty}</td><td className="py-1 text-right font-mono">RWF {fmt(it.price * it.qty)}</td></tr>
          ))}</tbody>
        </table>
        <div className="flex justify-between font-semibold border-t border-[var(--basalt)]/10 pt-2 mb-3"><span>Total</span><span className="font-mono">RWF {fmt(order.total)}</span></div>
        <div className="text-xs text-[var(--basalt)]/60 space-y-1">
          <div>Placed by {order.placedBy || "—"} · {new Date(order.placedAt).toLocaleString()}</div>
          {order.readyAt && <div>Marked ready by {order.readyBy || "—"} · {new Date(order.readyAt).toLocaleString()}</div>}
          {order.servedAt && <div>Served by {order.servedBy || "—"} · {new Date(order.servedAt).toLocaleString()}</div>}
          {order.billedAt && <div>Billed by {order.billedBy || "—"} · {new Date(order.billedAt).toLocaleString()} — {order.paymentMethod?.replace("_", " ")}, RWF {fmt(order.amountPaid)} received</div>}
          {order.cancelledAt && <div style={{ color: "var(--ember)" }}>Cancelled by {order.cancelledBy || "—"} · {new Date(order.cancelledAt).toLocaleString()} — {order.cancelReason}</div>}
        </div>
        <div className="flex justify-end mt-4"><button onClick={onClose} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Close</button></div>
      </Card>
    </div>
  );
}
