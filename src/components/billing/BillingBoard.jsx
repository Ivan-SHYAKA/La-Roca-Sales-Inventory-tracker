import { useMemo, useState } from "react";
import { Printer, Info, ChevronDown, Undo2 } from "lucide-react";
import { Card, SectionLabel, Badge, StatusBadge, PrimaryBtn } from "../ui";
import { LINES } from "../../lib/constants";
import { fmt, orderLabel } from "../../lib/format";
import { billOrder, cancelOrder, requestInvoiceRemoval, voidInvoices, restoreInvoices, decideInvoiceRemoval } from "../../lib/data";
import { groupOrders, summarize, distributeAmount } from "./groupOrders";
import { CancelModal } from "./CancelModal";
import { BillingModal } from "./BillingModal";
import { GroupDetailsModal } from "./GroupDetailsModal";
import { InvoiceModal } from "./InvoiceModal";
import { RemoveInvoiceModal, AnswerRequestModal, RestoreModal } from "./RemovalModals";

export function BillingBoard({ orders, removalRequests = [], session, refresh, onError }) {
  const [invoiceGroup, setInvoiceGroup] = useState(null);
  const [billingGroup, setBillingGroup] = useState(null);
  const [cancellingGroup, setCancellingGroup] = useState(null);
  const [detailsGroup, setDetailsGroup] = useState(null);
  const [removing, setRemoving] = useState(null);     // billed group being removed / asked about
  const [restoring, setRestoring] = useState(null);   // removed group being restored
  const [answering, setAnswering] = useState(null);   // { request, approve }
  const [showRemoved, setShowRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const isManager = session.role === "manager";

  const run = async (fn, failure) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      onError?.(e.message || failure);
    } finally {
      setBusy(false);
    }
  };

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

  // Removed (voided) invoices live in their own list, not in the pipeline.
  const groups = useMemo(
    () => groupOrders(orders.filter((o) => o.status !== "voided")).map(summarize).sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt)),
    [orders]
  );
  const removedGroups = useMemo(
    () => groupOrders(orders.filter((o) => o.status === "voided")).map(summarize)
      .sort((a, b) => new Date(b.orders[0].voidedAt || 0) - new Date(a.orders[0].voidedAt || 0)),
    [orders]
  );

  const idsOf = (g, status) => g.orders.filter((o) => o.status === status).map((o) => o.id);
  const overlaps = (r, ids) => r.orderIds.some((id) => ids.includes(id));
  const pending = removalRequests.filter((r) => r.status === "pending");
  const pendingFor = (g) => pending.find((r) => overlaps(r, g.orders.map((o) => o.id)));
  // The latest "no" for an invoice that's still billed, so sales knows why nothing happened.
  const rejectedFor = (g) => removalRequests.find((r) => r.status === "rejected" && overlaps(r, g.orders.map((o) => o.id)));

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

      {removing && (
        <RemoveInvoiceModal group={removing} mode={isManager ? "remove" : "request"} busy={busy} onClose={() => setRemoving(null)}
          onConfirm={(reason) => run(async () => {
            const ids = idsOf(removing, "billed");
            if (isManager) await voidInvoices(ids, reason); else await requestInvoiceRemoval(ids, reason);
            setRemoving(null);
          }, "Couldn't complete that — check your connection and try again.")} />
      )}
      {restoring && (
        <RestoreModal group={restoring} busy={busy} onClose={() => setRestoring(null)}
          onConfirm={() => run(async () => { await restoreInvoices(idsOf(restoring, "voided")); setRestoring(null); }, "Couldn't restore the invoice.")} />
      )}
      {answering && (
        <AnswerRequestModal request={answering.request} approve={answering.approve} busy={busy} onClose={() => setAnswering(null)}
          onConfirm={(note) => run(async () => { await decideInvoiceRemoval(answering.request.id, answering.approve, note); setAnswering(null); }, "Couldn't answer the request.")} />
      )}

      {isManager && pending.length > 0 && (
        <Card style={{ borderColor: "var(--ember)" }}>
          <SectionLabel>Removal requests waiting for you ({pending.length})</SectionLabel>
          <p className="text-xs text-[var(--basalt)]/50 mb-3">Sales / receptionist asked for these billed invoices to be removed. Nothing changes until you approve.</p>
          <div className="space-y-3">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded border border-[var(--basalt)]/10">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{r.label} <span className="font-mono text-xs text-[var(--basalt)]/60">RWF {fmt(r.total)}</span></div>
                  <div className="text-xs text-[var(--basalt)]/60">Asked by {r.requestedBy} · {new Date(r.requestedAt).toLocaleString()}</div>
                  <div className="text-xs mt-1">Reason: “{r.reason}”</div>
                </div>
                <div className="flex gap-2">
                  <PrimaryBtn color="var(--moss)" onClick={() => setAnswering({ request: r, approve: true })}>Approve</PrimaryBtn>
                  <button onClick={() => setAnswering({ request: r, approve: false })} className="px-3 py-2 rounded text-sm border border-[var(--basalt)]/20">Reject</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <SectionLabel>Orders pipeline</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Orders route straight to the kitchen or barista when a waiter places them — nothing to confirm here. A table's items across different lines are billed together as one receipt once everything for that table has been served.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
            <th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Line</th><th className="py-2 pr-3">Total</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Waiter</th><th className="py-2 pr-3">Placed</th><th></th>
          </tr></thead>
          <tbody>
            {groups.map((g) => {
              const waiting = g.isBilled ? pendingFor(g) : null;
              const refused = g.isBilled && !waiting ? rejectedFor(g) : null;
              return (
                <tr key={g.key} className="border-b border-[var(--basalt)]/5">
                  <td className="py-2 pr-3">
                    <button onClick={() => setDetailsGroup(g)} className="flex items-center gap-1 hover:underline">{orderLabel(g)} <Info size={11} className="text-[var(--basalt)]/30" /></button>
                  </td>
                  <td className="py-2 pr-3 flex gap-1 flex-wrap">{g.lines.map((l) => <Badge key={l} color={LINES[l].color}>{LINES[l].label}</Badge>)}</td>
                  <td className="py-2 pr-3 font-mono text-xs">RWF {fmt(g.total)}</td>
                  <td className="py-2 pr-3"><StatusBadge status={g.status} /></td>
                  <td className="py-2 pr-3 text-xs text-[var(--basalt)]/50">{g.placedBy}</td>
                  <td className="py-2 pr-3 text-xs text-[var(--basalt)]/50">{new Date(g.placedAt).toLocaleString()}</td>
                  <td className="py-2 flex gap-2 items-center flex-wrap">
                    {g.canPay && <button onClick={() => setBillingGroup(g)} className="text-xs text-[var(--moss)] font-medium">Take payment</button>}
                    {g.canCancel && <button onClick={() => setCancellingGroup(g)} className="text-xs text-[var(--ember)] font-medium">Cancel</button>}
                    {g.isBilled && <button onClick={() => setInvoiceGroup(g)} className="text-xs text-[var(--basalt)]/60 flex items-center gap-1"><Printer size={12} /> Invoice</button>}
                    {g.isBilled && isManager && <button onClick={() => setRemoving(g)} className="text-xs text-[var(--ember)] font-medium">Remove</button>}
                    {g.isBilled && !isManager && !waiting && <button onClick={() => setRemoving(g)} className="text-xs text-[var(--ember)] font-medium">Request removal</button>}
                    {waiting && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(184,146,63,0.18)", color: "var(--gold)" }}>Removal requested — waiting for the manager</span>}
                    {refused && !isManager && <span className="text-xs text-[var(--basalt)]/50" title={refused.decisionNote}>Not approved{refused.decisionNote ? `: ${refused.decisionNote}` : ""}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {groups.length === 0 && <p className="text-sm text-[var(--basalt)]/50">No orders yet.</p>}
      </Card>

      {removedGroups.length > 0 && (
        <Card>
          <button onClick={() => setShowRemoved((v) => !v)} className="w-full flex items-center justify-between text-left" aria-expanded={showRemoved}>
            <SectionLabel>Removed invoices ({removedGroups.length})</SectionLabel>
            <ChevronDown size={18} className="mb-3 transition-transform" style={{ transform: showRemoved ? "rotate(180deg)" : "none" }} />
          </button>
          {showRemoved && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
                <th className="py-2 pr-3">Client</th><th className="py-2 pr-3">Total</th><th className="py-2 pr-3">Removed</th><th className="py-2 pr-3">By</th><th className="py-2 pr-3">Reason</th><th></th>
              </tr></thead>
              <tbody>
                {removedGroups.map((g) => (
                  <tr key={g.key} className="border-b border-[var(--basalt)]/5">
                    <td className="py-2 pr-3">{orderLabel(g)}</td>
                    <td className="py-2 pr-3 font-mono text-xs">RWF {fmt(g.total)}</td>
                    <td className="py-2 pr-3 text-xs text-[var(--basalt)]/50">{g.orders[0].voidedAt ? new Date(g.orders[0].voidedAt).toLocaleString() : "—"}</td>
                    <td className="py-2 pr-3 text-xs">{g.orders[0].voidedBy || "—"}</td>
                    <td className="py-2 pr-3 text-xs">{g.orders[0].voidReason || "—"}</td>
                    <td className="py-2">{isManager && <button onClick={() => setRestoring(g)} className="text-xs text-[var(--moss)] font-medium flex items-center gap-1"><Undo2 size={12} /> Restore</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
