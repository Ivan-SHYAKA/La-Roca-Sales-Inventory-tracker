import { BellRing, X } from "lucide-react";

// Fixed top-right stack so kitchen/barista/sales notice a new order without staring at
// the queue count — a status-only change is too easy to miss when hands are busy.
export function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed top-4 right-4 z-[100] w-80 space-y-2">
      {toasts.map((t) => (
        <div key={t.id} className="rounded-md shadow-lg p-3 flex items-start gap-2 text-sm text-white" style={{ background: "var(--basalt)" }}>
          <BellRing size={16} className="mt-0.5 shrink-0" />
          <div className="flex-1">{t.message}</div>
          <button onClick={() => onDismiss(t.id)} className="text-white/50 hover:text-white shrink-0"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
