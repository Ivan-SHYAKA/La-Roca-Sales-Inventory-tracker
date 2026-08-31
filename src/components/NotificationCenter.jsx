import { useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle } from "lucide-react";
import { Card, SectionLabel, PrimaryBtn } from "./ui";
import { humanizeDuration, orderLabel } from "../lib/format";
import { acknowledgeNotification } from "../lib/data";

// Deliberately not dismissible by clicking outside or pressing Escape (unlike ConfirmModal)
// -- these are things a stock shortage, a low-stock item, or a new order landing on someone
// who wasn't watching the screen shouldn't let slip past unseen. One at a time, oldest
// first, so nothing gets buried under whatever arrived most recently; acknowledging one
// immediately reveals the next queued one underneath.
export function NotificationCenter({ notifications, orders, session, refresh, onError }) {
  const [busy, setBusy] = useState(false);
  const queue = useMemo(() => [...notifications].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [notifications]);
  const current = queue[0];
  if (!current) return null;

  // The DB message deliberately omits the table/section label (it doesn't know the floor
  // layout) -- prepend it here from the already-loaded order, when there is one.
  const order = current.orderId ? orders.find((o) => o.id === current.orderId) : null;
  const message = order ? `${orderLabel(order)} — ${current.message}` : current.message;

  const high = current.severity === "high";
  const acknowledge = async () => {
    setBusy(true);
    try {
      await acknowledgeNotification(current.id, session.id);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't acknowledge the notification — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] no-print">
      <Card className="w-full max-w-md border-2" style={{ borderColor: high ? "var(--ember)" : "var(--gold)" }}>
        <div className="flex items-center gap-2 mb-1">
          {high ? <AlertOctagon size={20} color="var(--ember)" /> : <AlertTriangle size={20} color="var(--gold)" />}
          <SectionLabel>{current.title}</SectionLabel>
        </div>
        <p className="text-sm mt-2">{message}</p>
        <p className="text-xs text-[var(--basalt)]/50 mt-3">
          {new Date(current.createdAt).toLocaleString()} · {humanizeDuration(Date.now() - new Date(current.createdAt).getTime())} ago
        </p>
        {queue.length > 1 && <p className="text-xs text-[var(--basalt)]/40 mt-1">{queue.length - 1} more waiting after this one.</p>}
        <div className="flex justify-end mt-4">
          <PrimaryBtn color={high ? "var(--ember)" : "var(--gold)"} disabled={busy} onClick={acknowledge}>
            {busy ? "…" : "I've seen this"}
          </PrimaryBtn>
        </div>
      </Card>
    </div>
  );
}
