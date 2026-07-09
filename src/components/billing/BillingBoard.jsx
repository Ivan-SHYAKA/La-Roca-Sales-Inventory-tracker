import { useState } from "react";
import { Printer, Info } from "lucide-react";
import { Card, SectionLabel, Badge, StatusBadge } from "../ui";
import { LINES } from "../../lib/constants";
import { fmt, orderLabel } from "../../lib/format";
import { billOrder, cancelOrder } from "../../lib/data";
import { groupOrders, summarize, distributeAmount } from "./groupOrders";
import { CancelModal } from "./CancelModal";
import { BillingModal } from "./BillingModal";
import { GroupDetailsModal } from "./GroupDetailsModal";
import { InvoiceModal } from "./InvoiceModal";

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
