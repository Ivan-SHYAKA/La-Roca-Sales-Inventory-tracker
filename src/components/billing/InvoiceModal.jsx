import { useState } from "react";
import { Printer, FileDown } from "lucide-react";
import { LINES } from "../../lib/constants";
import { fmt, orderLabel } from "../../lib/format";
import { saveInvoicePdf } from "../../lib/pdf";
import { sumPayments, paymentText } from "../../lib/payments";

export function InvoiceModal({ group, onClose, onError }) {
  const [saving, setSaving] = useState(false);
  const payments = sumPayments(group.orders);
  const paidText = paymentText(payments, fmt);
  const paymentMethod = paidText;
  const amountPaid = group.orders.reduce((s, o) => s + (o.amountPaid || 0), 0);
  const lineLabel = group.lines.map((l) => LINES[l].label).join(" + ");
  const mixed = group.lines.length > 1;

  const save = async () => {
    setSaving(true);
    try {
      const pseudoOrder = {
        id: group.key, client: group.client, tableNumber: group.tableNumber, phone: group.phone,
        items: group.items, total: group.total, line: group.line,
        placedAt: group.placedAt, servedAt: group.servedAt, paymentMethod, amountPaid,
      };
      const saved = await saveInvoicePdf(pseudoOrder, lineLabel);
      if (!saved) return; // user cancelled the folder/file picker
    } catch (e) {
      onError?.(e.message || "Couldn't save the PDF — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-md p-8 w-full max-w-md invoice-print" onClick={(e) => e.stopPropagation()}>
        <h2 className="lr-display text-2xl mb-1">La Roca</h2>
        <p className="text-xs text-[var(--basalt)]/50 mb-4">{lineLabel} · Invoice</p>
        <p className="text-sm mb-1"><strong>Client:</strong> {orderLabel(group)}</p>
        {group.phone && <p className="text-sm mb-3"><strong>Phone:</strong> {group.phone}</p>}
        <table className="w-full text-sm mb-3">
          <thead><tr className="text-left border-b border-black/10"><th className="py-1">Item</th><th className="py-1">Qty</th><th className="py-1 text-right">Amount</th></tr></thead>
          <tbody>{group.items.map((it, i) => (
            <tr key={i}>
              <td className="py-1">{mixed ? `${it.name} (${LINES[it.line].label})` : it.name}</td>
              <td className="py-1">{it.qty}</td>
              <td className="py-1 text-right font-mono">{fmt(it.price * it.qty)}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="flex justify-between font-semibold border-t border-black/10 pt-2"><span>Total</span><span className="font-mono">RWF {fmt(group.total)}</span></div>
        {paidText && <p className="text-sm mt-2">Paid: {paidText} · RWF {fmt(amountPaid)} received</p>}
        <p className="text-xs text-[var(--basalt)]/40 mt-4">Placed {new Date(group.placedAt).toLocaleString()}{group.servedAt && ` · Served ${new Date(group.servedAt).toLocaleString()}`}</p>
        <div className="flex gap-2 mt-6 no-print">
          <button onClick={() => window.print()} className="flex-1 py-2 rounded text-sm font-medium text-white flex items-center justify-center gap-1.5" style={{ background: "var(--basalt)" }}><Printer size={14} /> Print</button>
          <button disabled={saving} onClick={save} className="flex-1 py-2 rounded text-sm font-medium text-white flex items-center justify-center gap-1.5 disabled:opacity-50" style={{ background: "var(--moss)" }}><FileDown size={14} /> {saving ? "Saving…" : "Save as PDF"}</button>
          <button onClick={onClose} className="flex-1 py-2 rounded text-sm font-medium border border-[var(--basalt)]/20">Close</button>
        </div>
      </div>
    </div>
  );
}
