import { useState } from "react";
import { Clock, CheckCircle2, Info } from "lucide-react";
import { Card, SectionLabel, PrimaryBtn, ConfirmModal, FlagsPanel } from "./ui";
import { OrderDetailsModal } from "./OrderDetails";
import { LINES } from "../lib/constants";
import { mins, orderLabel, humanizeDuration } from "../lib/format";
import { serveOrder } from "../lib/data";
import { groupOrdersByGroupId } from "../lib/business";

// The waiter's own acknowledgement step: kitchen/barista marking an order "ready" only
// means it's sitting on the pass — it isn't actually in front of the guest until the
// waiter who placed it confirms they delivered it. That confirmation is what flips the
// order to "served" and is what BillingBoard/sales sees update live.
export function ReadyToServe({ orders, session, refresh, onError, flags = [] }) {
  const [confirming, setConfirming] = useState(null); // a single line-order, not the whole group
  const [detailsOrder, setDetailsOrder] = useState(null);
  const [busy, setBusy] = useState(false);

  // Serving is per line, not per group: each line gets its own "Mark served" once it's
  // ready, and the group card stays visible — showing which lines are still out — until
  // every line in it has been served.
  const myActive = orders.filter((o) => o.placedById === session.id && (o.status === "placed" || o.status === "ready"));
  const groups = groupOrdersByGroupId(myActive)
    .filter((g) => g.some((o) => o.status === "ready"))
    .map((g) => ({ key: g.map((o) => o.id).sort().join("-"), orders: g }))
    .sort((a, b) => new Date(a.orders[0].placedAt) - new Date(b.orders[0].placedAt));

  const confirmServed = async () => {
    setBusy(true);
    try {
      await serveOrder(confirming.id, session);
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
          <p className="text-sm">Confirm you've delivered this to {orderLabel(confirming)}:</p>
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
              const mixed = new Set(g.orders.map((o) => o.line)).size > 1;
              return (
                <div key={g.key} className="p-3 rounded border border-[var(--basalt)]/10">
                  <div className="font-medium text-sm flex items-center gap-1.5 mb-2">
                    {orderLabel(g.orders[0])}
                    {mixed && <span className="text-xs text-[var(--basalt)]/40 font-normal">· {[...new Set(g.orders.map((o) => LINES[o.line].label))].join(" + ")}</span>}
                  </div>
                  <div className="space-y-2">
                    {g.orders.map((o) => {
                      const waiting = o.readyAt ? mins(Date.now() - new Date(o.readyAt).getTime()) : null;
                      return (
                        <div key={o.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <button onClick={() => setDetailsOrder(o)} className="text-sm flex items-center gap-1.5 hover:underline text-left">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LINES[o.line].color }} />
                              <span className="truncate">{o.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</span>
                              <Info size={11} className="text-[var(--basalt)]/30 shrink-0" />
                            </button>
                            <div className="text-xs mt-0.5 flex items-center gap-1" style={{ color: o.status === "ready" ? "inherit" : "var(--gold)" }}>
                              <Clock size={11} />
                              {o.status === "ready" ? `Ready ${humanizeDuration(waiting * 60000)} ago` : `Still waiting on ${LINES[o.line].label.toLowerCase()}`}
                            </div>
                          </div>
                          <PrimaryBtn color="var(--moss)" disabled={o.status !== "ready"} onClick={() => setConfirming(o)}>Mark served</PrimaryBtn>
                        </div>
                      );
                    })}
                  </div>
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
