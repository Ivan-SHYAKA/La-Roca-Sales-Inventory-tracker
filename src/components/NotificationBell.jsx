import { useMemo, useState } from "react";
import { Bell, AlertOctagon, AlertTriangle, CheckCheck } from "lucide-react";
import { humanizeDuration, orderLabel } from "../lib/format";
import { acknowledgeNotifications } from "../lib/data";

// Alerts live here instead of interrupting with a popup: a bell with a count, and a short
// list underneath. New ones also arrive as a toast with a sound (see LaRocaSystem). Nobody has
// to press anything for the system to have recorded them — "Mark all as read" only clears the
// count (for the whole role), it doesn't remove the record.
export function NotificationBell({ notifications, orders, session, refresh, onError }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => [...notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)), [notifications]);
  const orderMap = useMemo(() => Object.fromEntries(orders.map((o) => [o.id, o])), [orders]);

  const markAll = async () => {
    setBusy(true);
    try {
      await acknowledgeNotifications(list.map((n) => n.id), session.id);
      await refresh();
      setOpen(false);
    } catch (e) {
      onError?.(e.message || "Couldn't mark them as read — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={`Alerts${list.length ? `, ${list.length} unread` : ""}`} aria-expanded={open}
        className="relative p-2 rounded-md border border-[var(--basalt)]/10 bg-[var(--cream)]">
        <Bell size={18} />
        {list.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold text-white flex items-center justify-center" style={{ background: "var(--ember)" }}>
            {list.length > 99 ? "99+" : list.length}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 z-50 w-[min(92vw,22rem)] bg-[var(--cream)] border border-[var(--basalt)]/15 rounded-md shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--basalt)]/10">
              <span className="text-xs uppercase tracking-wide font-semibold text-[var(--basalt)]/70">Alerts</span>
              <button onClick={markAll} disabled={busy || list.length === 0} className="text-xs flex items-center gap-1 text-[var(--basalt)]/70 disabled:opacity-40">
                <CheckCheck size={13} /> Mark all as read
              </button>
            </div>
            {list.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[var(--basalt)]/50">Nothing new.</p>
            ) : (
              <ul className="max-h-80 overflow-y-auto divide-y divide-[var(--basalt)]/5">
                {list.map((n) => {
                  const o = n.orderId ? orderMap[n.orderId] : null;
                  const high = n.severity === "high";
                  return (
                    <li key={n.id} className="px-3 py-2.5 flex gap-2 text-sm">
                      {high ? <AlertOctagon size={15} className="mt-0.5 shrink-0" color="var(--ember)" /> : <AlertTriangle size={15} className="mt-0.5 shrink-0" color="var(--gold)" />}
                      <div className="min-w-0">
                        <div className="font-medium">{n.title}</div>
                        <div className="text-[var(--basalt)]/80 break-words">{o ? `${orderLabel(o)} — ` : ""}{n.message}</div>
                        <div className="text-[11px] text-[var(--basalt)]/40 mt-0.5">{humanizeDuration(Date.now() - new Date(n.createdAt).getTime())} ago</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
