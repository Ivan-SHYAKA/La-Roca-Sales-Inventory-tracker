import { useState } from "react";
import { Card, SectionLabel, Input, Select, PrimaryBtn } from "../ui";
import { LINES } from "../../lib/constants";
import { fmt, orderLabel } from "../../lib/format";

export function BillingModal({ group, onClose, onConfirm }) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [amountPaid, setAmountPaid] = useState(group.total);
  const mixed = group.lines.length > 1;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <SectionLabel>Take payment — {orderLabel(group)}</SectionLabel>
        <div className="space-y-1 mb-3">
          {group.items.map((it, i) => (
            <div key={i} className="flex justify-between text-xs text-[var(--basalt)]/70">
              <span className="flex items-center gap-1.5">
                {mixed && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LINES[it.line].color }} />}
                {it.qty}× {it.name}
              </span>
              <span className="font-mono">RWF {fmt(it.price * it.qty)}</span>
            </div>
          ))}
        </div>
        <p className="text-sm mb-3 border-t border-[var(--basalt)]/10 pt-2">Total due: <span className="font-mono font-semibold">RWF {fmt(group.total)}</span></p>
        <label className="text-xs text-[var(--basalt)]/60">Payment method</label>
        <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
          <option value="cash">Cash</option><option value="mobile_money">Mobile money</option><option value="card">Card</option>
        </Select>
        <label className="text-xs text-[var(--basalt)]/60 mt-3 block">Amount received (RWF)</label>
        <Input type="number" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
        <div className="flex gap-2 mt-4">
          <PrimaryBtn color="var(--moss)" onClick={() => onConfirm({ paymentMethod, amountPaid: Number(amountPaid) || group.total })}>Confirm & bill</PrimaryBtn>
          <button onClick={onClose} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Cancel</button>
        </div>
      </Card>
    </div>
  );
}
