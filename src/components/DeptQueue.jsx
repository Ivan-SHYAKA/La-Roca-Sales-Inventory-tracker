import { useState } from "react";
import { Clock, CheckCircle2, Info } from "lucide-react";
import { Card, SectionLabel, PrimaryBtn, ConfirmModal, FlagsPanel } from "./ui";
import { OrderDetailsModal } from "./OrderDetails";
import { estimateServeMinutes } from "../lib/business";
import { mins, orderLabel, humanizeDuration } from "../lib/format";
import { markOrderReady } from "../lib/data";

export function DeptQueue({ dept, line, orders, session, refresh, onError, flags = [] }) {
  const [confirming, setConfirming] = useState(null);
  const [detailsOrder, setDetailsOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const queue = orders.filter((o) => o.line === line && o.status === "placed").sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
  const confirmReady = async () => {
    setBusy(true);
    try {
      await markOrderReady(confirming.id, session);
      setConfirming(null);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't update the order — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const label = dept === "kitchen" ? "Kitchen" : "Barista";

  return (
    <div className="space-y-6">
      {confirming && (
        <ConfirmModal title={`Mark ${dept === "kitchen" ? "cooked" : "ready"}?`} confirmLabel="Confirm" busy={busy} onConfirm={confirmReady} onClose={() => setConfirming(null)}>
          <p className="text-sm">This tells the waiter {orderLabel(confirming)}'s order is ready to be served:</p>
          <p className="text-xs text-[var(--basalt)]/60 mt-1">{confirming.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</p>
        </ConfirmModal>
      )}
      {detailsOrder && <OrderDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />}
      <Card>
        <SectionLabel>{label} queue ({queue.length})</SectionLabel>
        {queue.length === 0 ? <p className="text-sm text-[var(--basalt)]/50 flex items-center gap-2"><CheckCircle2 size={16} /> Nothing waiting right now.</p> : (
          <div className="space-y-3">
            {queue.map((o) => {
              const eta = estimateServeMinutes(o, orders);
              const elapsed = mins(Date.now() - new Date(o.placedAt).getTime());
              const late = elapsed > eta;
              return (
                <div key={o.id} className="flex items-center justify-between p-3 rounded border border-[var(--basalt)]/10">
                  <div>
                    <button onClick={() => setDetailsOrder(o)} className="font-medium text-sm flex items-center gap-1 hover:underline">
                      {orderLabel(o)} <Info size={11} className="text-[var(--basalt)]/30" /> <span className="text-xs text-[var(--basalt)]/40 font-normal">· taken by {o.placedBy}</span>
                    </button>
                    <div className="text-xs text-[var(--basalt)]/60 mt-1">{o.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</div>
                    <div className="text-xs mt-1 flex items-center gap-1" style={{ color: late ? "var(--ember)" : "var(--basalt)99" }}>
                      <Clock size={12} /> Estimated {humanizeDuration(eta * 60000)} · elapsed {humanizeDuration(elapsed * 60000)} {late && "— running late"}
                    </div>
                  </div>
                  <PrimaryBtn color="var(--gold)" onClick={() => setConfirming(o)}>Mark {dept === "kitchen" ? "cooked" : "ready"}</PrimaryBtn>
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
