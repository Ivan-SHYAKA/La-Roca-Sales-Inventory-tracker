import { useState } from "react";
import { Printer, FileDown, Info } from "lucide-react";
import { Card, SectionLabel, Input, Select, Badge, PrimaryBtn, StatusBadge, ConfirmModal } from "./ui";
import { LINES } from "../lib/constants";
import { fmt, orderLabel } from "../lib/format";
import { billOrder, cancelOrder } from "../lib/data";
import { saveInvoicePdf } from "../lib/pdf";

const STATUS_ORDER = ["placed", "ready", "served", "billed"];

// A waiter's cart can span multiple lines now (a burger + a cappuccino), which under the
// hood becomes one order per line so kitchen/barista routing stays simple — but the guest
// still thinks of it as one table's bill. This regroups those sibling orders back into a
// single row for billing so sales only ever takes one payment and prints one receipt per
// table, not one per department. Orders without a table number (older data, or bookings
// identified by client name only) are left as their own single-order "group".
//
// Billed/cancelled orders are grouped by table + close billed/cancelled timestamps (same
// minute) rather than by table alone, since a table number gets reused across separate
// sittings — grouping strictly by table forever would merge unrelated past visits.
function groupOrders(orders) {
  const used = new Set();
  const groups = [];
  orders.forEach((o) => {
    if (used.has(o.id)) return;
    let siblings;
    if (!o.tableNumber) {
      siblings = [o];
    } else if (o.status === "billed" || o.status === "cancelled") {
      const ts = new Date(o.billedAt || o.cancelledAt || o.placedAt).getTime();
      siblings = orders.filter((x) =>
        !used.has(x.id) && x.tableNumber === o.tableNumber &&
        (x.status === "billed" || x.status === "cancelled") &&
        Math.abs(new Date(x.billedAt || x.cancelledAt || x.placedAt).getTime() - ts) < 60000
      );
    } else {
      siblings = orders.filter((x) =>
        !used.has(x.id) && x.tableNumber === o.tableNumber &&
        x.status !== "billed" && x.status !== "cancelled"
      );
    }
    siblings.forEach((s) => used.add(s.id));
    groups.push(siblings);
  });
  return groups;
}

function summarize(group) {
  const first = group[0];
  const active = group.filter((o) => o.status !== "cancelled");
  const lines = [...new Set(group.map((o) => o.line))];
  const items = group.flatMap((o) => o.items.map((it) => ({ ...it, line: o.line })));
  const total = group.reduce((s, o) => s + o.total, 0);
  const status = active.length === 0
    ? "cancelled"
    : active.reduce((min, o) => STATUS_ORDER.indexOf(o.status) < STATUS_ORDER.indexOf(min) ? o.status : min, "billed");
  const servedDates = group.map((o) => o.servedAt).filter(Boolean).sort();
  const billedDates = group.map((o) => o.billedAt).filter(Boolean).sort();
  return {
    key: group.map((o) => o.id).sort().join("-"),
    orders: group,
    activeOrders: active,
    tableNumber: first.tableNumber,
    client: first.client,
    phone: group.find((o) => o.phone)?.phone,
    placedBy: first.placedBy,
    placedAt: group.map((o) => o.placedAt).sort()[0],
    servedAt: servedDates[servedDates.length - 1],
    billedAt: billedDates[billedDates.length - 1],
    line: lines[0],
    lines,
    items,
    total,
    status,
    canPay: active.length > 0 && active.every((o) => o.status === "served"),
    canCancel: active.some((o) => o.status === "placed" || o.status === "ready" || o.status === "served"),
    isBilled: active.length > 0 && active.every((o) => o.status === "billed"),
  };
}

// Splits a combined "amount received" across the sibling orders proportionally to each
// one's own total, so per-order accounting (amount_paid) still adds up to what was
// actually taken — the last order absorbs any rounding remainder.
function distributeAmount(amount, orders) {
  const total = orders.reduce((s, o) => s + o.total, 0) || 1;
  let remaining = amount;
  return orders.map((o, i) => {
    if (i === orders.length - 1) return remaining;
    const share = Math.round((o.total / total) * amount);
    remaining -= share;
    return share;
  });
}

export function BillingBoard({ orders, session, refresh, onError }) {
  const [invoiceGroup, setInvoiceGroup] = useState(null);
  const [billingGroup, setBillingGroup] = useState(null);
  const [cancellingGroup, setCancellingGroup] = useState(null);
  const [detailsGroup, setDetailsGroup] = useState(null);
  const [busy, setBusy] = useState(false);

  const doCancel = async (reason) => {
    setBusy(true);
    try {
      const toCancel = cancellingGroup.activeOrders.filter((o) => o.status !== "billed");
      for (const o of toCancel) await cancelOrder(o.id, session, reason);
      setCancellingGroup(null);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't cancel the order — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const groups = groupOrders(orders).map(summarize).sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt));

  return (
    <div className="space-y-4">
      {invoiceGroup && <InvoiceModal group={invoiceGroup} onClose={() => setInvoiceGroup(null)} onError={onError} />}
      {billingGroup && <BillingModal group={billingGroup}
        onClose={() => setBillingGroup(null)}
        onConfirm={async (payment) => {
          try {
            const toBill = billingGroup.activeOrders;
            const shares = distributeAmount(payment.amountPaid, toBill);
            for (let i = 0; i < toBill.length; i++) {
              await billOrder(toBill[i].id, session, { paymentMethod: payment.paymentMethod, amountPaid: shares[i] });
            }
            setInvoiceGroup({
              ...billingGroup,
              orders: toBill.map((o, i) => ({ ...o, status: "billed", paymentMethod: payment.paymentMethod, amountPaid: shares[i] })),
            });
            setBillingGroup(null);
            await refresh();
          } catch (e) {
            onError?.(e.message || "Couldn't record the payment — check your connection and try again.");
          }
        }} />}
      {cancellingGroup && <CancelModal group={cancellingGroup} busy={busy} onClose={() => setCancellingGroup(null)} onConfirm={doCancel} />}
      {detailsGroup && <GroupDetailsModal group={detailsGroup} onClose={() => setDetailsGroup(null)} />}
      <Card>
        <SectionLabel>Orders pipeline</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Orders route straight to the kitchen or barista when a waiter places them — nothing to confirm here. A table's items across different lines are billed together as one receipt once everything for that table has been served.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
            <th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Line</th><th className="py-2 pr-3">Total</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Waiter</th><th className="py-2 pr-3">Placed</th><th></th>
          </tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-b border-[var(--basalt)]/5">
                <td className="py-2 pr-3">
                  <button onClick={() => setDetailsGroup(g)} className="flex items-center gap-1 hover:underline">{orderLabel(g)} <Info size={11} className="text-[var(--basalt)]/30" /></button>
                </td>
                <td className="py-2 pr-3 flex gap-1 flex-wrap">{g.lines.map((l) => <Badge key={l} color={LINES[l].color}>{LINES[l].label}</Badge>)}</td>
                <td className="py-2 pr-3 font-mono text-xs">RWF {fmt(g.total)}</td>
                <td className="py-2 pr-3"><StatusBadge status={g.status} /></td>
                <td className="py-2 pr-3 text-xs text-[var(--basalt)]/50">{g.placedBy}</td>
                <td className="py-2 pr-3 text-xs text-[var(--basalt)]/50">{new Date(g.placedAt).toLocaleString()}</td>
                <td className="py-2 flex gap-2">
                  {g.canPay && <button onClick={() => setBillingGroup(g)} className="text-xs text-[var(--moss)] font-medium">Take payment</button>}
                  {g.canCancel && <button onClick={() => setCancellingGroup(g)} className="text-xs text-[var(--ember)] font-medium">Cancel</button>}
                  {g.isBilled && <button onClick={() => setInvoiceGroup(g)} className="text-xs text-[var(--basalt)]/60 flex items-center gap-1"><Printer size={12} /> Invoice</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && <p className="text-sm text-[var(--basalt)]/50">No orders yet.</p>}
      </Card>
    </div>
  );
}

function CancelModal({ group, busy, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmModal title={`Cancel order — ${orderLabel(group)}?`} confirmLabel="Confirm cancel" confirmColor="var(--ember)" busy={busy}
      onConfirm={() => onConfirm(reason.trim() || "Not specified")} onClose={onClose}>
      <p className="text-xs text-[var(--basalt)]/60 mb-2">{group.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</p>
      <label className="text-xs text-[var(--basalt)]/60">Reason for cancelling</label>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. client changed their mind" autoFocus />
    </ConfirmModal>
  );
}

function BillingModal({ group, onClose, onConfirm }) {
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

function GroupDetailsModal({ group, onClose }) {
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

function InvoiceModal({ group, onClose, onError }) {
  const [saving, setSaving] = useState(false);
  const paymentMethod = group.orders.find((o) => o.paymentMethod)?.paymentMethod;
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
        {paymentMethod && <p className="text-sm mt-2">Paid via {paymentMethod.replace("_", " ")} · RWF {fmt(amountPaid)} received</p>}
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
