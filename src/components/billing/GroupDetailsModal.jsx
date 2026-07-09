import { Card, SectionLabel, Badge, StatusBadge } from "../ui";
import { LINES } from "../../lib/constants";
import { fmt, orderLabel } from "../../lib/format";

export function GroupDetailsModal({ group, onClose }) {
  const mixed = group.lines.length > 1;
  const cancelledOrders = group.orders.filter((o) => o.cancelledAt);
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <SectionLabel>{orderLabel(group)}</SectionLabel>
          {group.lines.map((l) => <Badge key={l} color={LINES[l].color}>{LINES[l].label}</Badge>)}
          <StatusBadge status={group.status} />
        </div>
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-left border-b border-[var(--basalt)]/10 text-xs uppercase text-[var(--basalt)]/50"><th className="py-1">Item</th><th className="py-1">Qty</th><th className="py-1 text-right">Subtotal</th></tr></thead>
          <tbody>{group.items.map((it, i) => (
            <tr key={i}>
              <td className="py-1"><span className="flex items-center gap-1.5">{mixed && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LINES[it.line].color }} />}{it.name}</span></td>
              <td className="py-1">{it.qty}</td>
              <td className="py-1 text-right font-mono">RWF {fmt(it.price * it.qty)}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="flex justify-between font-semibold border-t border-[var(--basalt)]/10 pt-2 mb-3"><span>Total</span><span className="font-mono">RWF {fmt(group.total)}</span></div>
        <div className="text-xs text-[var(--basalt)]/60 space-y-1">
          <div>Placed by {group.placedBy || "—"} · {new Date(group.placedAt).toLocaleString()}</div>
          {group.servedAt && <div>Served · {new Date(group.servedAt).toLocaleString()}</div>}
          {group.isBilled && <div>Billed · {new Date(group.billedAt).toLocaleString()}</div>}
          {cancelledOrders.map((o) => (
            <div key={o.id} style={{ color: "var(--ember)" }}>Cancelled ({LINES[o.line].label}) by {o.cancelledBy || "—"} · {new Date(o.cancelledAt).toLocaleString()} — {o.cancelReason}</div>
          ))}
        </div>
        <div className="flex justify-end mt-4"><button onClick={onClose} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Close</button></div>
      </Card>
    </div>
  );
}
