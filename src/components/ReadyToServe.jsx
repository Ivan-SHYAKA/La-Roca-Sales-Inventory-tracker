import { useState } from "react";
import { Clock, CheckCircle2, Info } from "lucide-react";
import { Card, SectionLabel, PrimaryBtn, ConfirmModal, FlagsPanel } from "./ui";
import { OrderDetailsModal } from "./OrderDetails";
import { LINES } from "../lib/constants";
import { mins, orderLabel } from "../lib/format";
import { serveOrder } from "../lib/data";

// A table's order can be split across lines (a burger from the kitchen, a cappuccino from
// the barista) even though the waiter thinks of it as one ticket — so this groups them back
// by table for the "I delivered this" confirmation, the same way BillingBoard groups them
// for payment. Marking served is one action per table, not one per department.
function groupByTable(orders) {
  const used = new Set();
  const groups = [];
  orders.forEach((o) => {
    if (used.has(o.id)) return;
    const siblings = o.tableNumber
      ? orders.filter((x) => !used.has(x.id) && x.tableNumber === o.tableNumber)
      : [o];
    siblings.forEach((s) => used.add(s.id));
    groups.push(siblings);
  });
  return groups;
}

// The waiter's own acknowledgement step: kitchen/barista marking an order "ready" only
// means it's sitting on the pass — it isn't actually in front of the guest until the
// waiter who placed it confirms they delivered it. That confirmation is what flips the
// order to "served" and is what BillingBoard/sales sees update live.
export function ReadyToServe({ orders, session, refresh, onError, flags = [] }) {
  const [confirming, setConfirming] = useState(null);
  const [detailsOrder, setDetailsOrder] = useState(null);
  const [busy, setBusy] = useState(false);

  const myActive = orders.filter((o) => o.placedById === session.id && (o.status === "placed" || o.status === "ready"));
  const groups = groupByTable(myActive)
    .filter((g) => g.some((o) => o.status === "ready"))
    .map((g) => ({
      key: g.map((o) => o.id).sort().join("-"),
      orders: g,
      allReady: g.every((o) => o.status === "ready"),
      pendingLines: g.filter((o) => o.status !== "ready").map((o) => LINES[o.line].label),
      readyAt: g.map((o) => o.readyAt).filter(Boolean).sort()[0],
      items: g.flatMap((o) => o.items.map((it) => ({ ...it, line: o.line }))),
      lines: [...new Set(g.map((o) => o.line))],
    }))
    .sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));

  const confirmServed = async () => {
    setBusy(true);
    try {
      for (const o of confirming.orders) await serveOrder(o.id, session);
      setConfirming(null);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't update the order — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {confirming && (
        <ConfirmModal title="Confirm served?" confirmLabel="Yes, delivered" busy={busy} onConfirm={confirmServed} onClose={() => setConfirming(null)}>
          <p className="text-sm">Confirm you've delivered this order to {orderLabel({ ...confirming.orders[0] })}:</p>
          <p className="text-xs text-[var(--basalt)]/60 mt-1">{confirming.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</p>
        </ConfirmModal>
      )}
      {detailsOrder && <OrderDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />}
      <Card>
        <SectionLabel>Ready to serve ({groups.length})</SectionLabel>
        {groups.length === 0 ? (
          <p className="text-sm text-[var(--basalt)]/50 flex items-center gap-2"><CheckCircle2 size={16} /> Nothing waiting on you right now.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const waiting = mins(Date.now() - new Date(g.readyAt).getTime());
              const mixed = g.lines.length > 1;
              return (
                <div key={g.key} className="flex items-center justify-between p-3 rounded border border-[var(--basalt)]/10">
                  <div>
                    <button onClick={() => setDetailsOrder(g.orders[0])} className="font-medium text-sm flex items-center gap-1 hover:underline">
                      {orderLabel(g.orders[0])} <Info size={11} className="text-[var(--basalt)]/30" />
                      <span className="text-xs text-[var(--basalt)]/40 font-normal">· {g.lines.map((l) => LINES[l].label).join(" + ")}</span>
                    </button>
                    <div className="text-xs text-[var(--basalt)]/60 mt-1">
                      {g.items.map((it) => mixed ? `${it.qty}× ${it.name} (${LINES[it.line].label})` : `${it.qty}× ${it.name}`).join(", ")}
                    </div>
                    {g.allReady ? (
                      <div className="text-xs mt-1 flex items-center gap-1 text-[var(--basalt)]/60"><Clock size={12} /> Ready {waiting} min ago</div>
                    ) : (
                      <div className="text-xs mt-1 flex items-center gap-1" style={{ color: "var(--gold)" }}><Clock size={12} /> Still waiting on: {g.pendingLines.join(", ")}</div>
                    )}
                  </div>
                  <PrimaryBtn color="var(--moss)" disabled={!g.allReady} onClick={() => setConfirming(g)}>Mark served</PrimaryBtn>
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <FlagsPanel flags={flags} />
    </div>
  );
}
