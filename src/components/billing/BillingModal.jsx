import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, SectionLabel, Input, Select, PrimaryBtn, Req, MissingHint } from "../ui";
import { LINES } from "../../lib/constants";
import { fmt, orderLabel } from "../../lib/format";
import { METHODS } from "../../lib/payments";
import { isNonNegative } from "../../lib/validate";

// Taking payment for a bill. The amount can be split between methods (for example 10,000 by
// MoMo and 5,000 in cash): add a row per method. onConfirm gets the payments merged per method.
export function BillingModal({ group, onClose, onConfirm }) {
  const [rows, setRows] = useState([{ method: "cash", amount: String(group.total) }]);
  const mixed = group.lines.length > 1;

  const received = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const balance = group.total - received;
  const problems = [];
  if (rows.some((r) => !isNonNegative(r.amount))) problems.push("an amount (0 or more) on every payment");
  else if (received <= 0) problems.push("an amount received");

  // Methods not yet used, so a method can't be listed twice.
  const unused = useMemo(() => Object.keys(METHODS).filter((m) => !rows.some((r) => r.method === m)), [rows]);
  const setRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { method: unused[0], amount: balance > 0 ? String(balance) : "" }]);

  const confirm = () => {
    const merged = {};
    rows.forEach((r) => { const a = Number(r.amount) || 0; if (a > 0) merged[r.method] = (merged[r.method] || 0) + a; });
    onConfirm({ payments: Object.entries(merged).map(([method, amount]) => ({ method, amount })) });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <SectionLabel>Take payment — {orderLabel(group)}{group.client ? ` · ${group.client}` : ""}</SectionLabel>
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

        <label className="text-xs text-[var(--basalt)]/60">How it's paid<Req /></label>
        <div className="space-y-2 mt-1">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="w-36">
                <Select value={r.method} onChange={(e) => setRow(i, { method: e.target.value })}>
                  {Object.entries(METHODS).filter(([k]) => k === r.method || unused.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <Input type="number" min="0" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} className="!mt-1" />
              {rows.length > 1 && (
                <button onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))} aria-label="Remove this payment"><Trash2 size={14} className="text-[var(--basalt)]/40" /></button>
              )}
            </div>
          ))}
        </div>
        {unused.length > 0 && (
          <button onClick={addRow} className="text-xs flex items-center gap-1 text-[var(--basalt)]/60 mt-2"><Plus size={12} /> Pay part with another method (e.g. MoMo + cash)</button>
        )}

        <div className="text-xs mt-3 flex justify-between">
          <span className="text-[var(--basalt)]/60">Received</span>
          <span className="font-mono">RWF {fmt(received)}</span>
        </div>
        {balance !== 0 && (
          <div className="text-xs mt-1 flex justify-between" style={{ color: balance > 0 ? "var(--ember)" : "var(--moss)" }}>
            <span>{balance > 0 ? "Still to pay" : "More than the bill"}</span>
            <span className="font-mono">RWF {fmt(Math.abs(balance))}</span>
          </div>
        )}
        <MissingHint items={problems} className="mt-2" />
        <div className="flex gap-2 mt-4">
          <PrimaryBtn color="var(--moss)" disabled={problems.length > 0} onClick={confirm}>Confirm & bill</PrimaryBtn>
          <button onClick={onClose} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Cancel</button>
        </div>
      </Card>
    </div>
  );
}
