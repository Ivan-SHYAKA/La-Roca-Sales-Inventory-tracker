import { BellRing, AlertTriangle, X } from "lucide-react";

const STYLE_BY_TYPE = {
  info: { background: "var(--basalt)", icon: BellRing },
  error: { background: "var(--ember)", icon: AlertTriangle },
  warn: { background: "var(--gold)", icon: AlertTriangle },
};

// Fixed top-right stack so kitchen/barista/sales notice a new order without staring at
// the queue count — a status-only change is too easy to miss when hands are busy. Also
// doubles as the app-wide error/notification popup (see onError wiring in
// LaRocaSystem) instead of a static inline banner, so a failed action is as hard to
// miss as a new order arriving.
export function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] w-80 space-y-2">
      {toasts.map((t) => {
        const { background, icon: Icon } = STYLE_BY_TYPE[t.type] || STYLE_BY_TYPE.info;
        return (
          <div key={t.id} className="rounded-md shadow-lg p-3 flex items-start gap-2 text-sm text-white" style={{ background }}>
            <Icon size={16} className="mt-0.5 shrink-0" />
            <div className="flex-1">{t.message}</div>
            <button onClick={() => onDismiss(t.id)} className="text-white/50 hover:text-white shrink-0"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
