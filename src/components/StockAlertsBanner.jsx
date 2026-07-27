import { AlertOctagon, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, SectionLabel, Badge } from "./ui";
import { resolveStockAlert } from "../lib/data";

// Shown only to kitchen/storekeeper/manager (gated by the caller, same pattern as the
// rest of the app's role-based nav) — kitchen is read-only, storekeeper/manager can
// resolve once restocked.
export function StockAlertsBanner({ alerts, canResolve, refresh, onError }) {
  const resolve = async (id) => {
    try {
      await resolveStockAlert(id);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't resolve the alert — check your connection and try again.");
    }
  };

  return (
    <Card className="mb-6">
      <SectionLabel>Stock alerts</SectionLabel>
      {alerts.length === 0 ? (
        <p className="text-sm text-[var(--basalt)]/50 flex items-center gap-2"><CheckCircle2 size={16} /> Nothing unresolved right now.</p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2">
                {a.severity === "blocked_order"
                  ? <AlertOctagon size={14} color="var(--ember)" />
                  : <AlertTriangle size={14} color="var(--gold)" />}
                <Badge color={a.severity === "blocked_order" ? "var(--ember)" : "var(--gold)"}>
                  {a.severity === "blocked_order" ? "blocked order" : "low stock"}
                </Badge>
                {a.message}
              </span>
              {canResolve && (
                <button onClick={() => resolve(a.id)} className="text-xs px-2.5 py-1 rounded border border-[var(--basalt)]/20 shrink-0 hover:bg-[var(--basalt)]/5">
                  Mark resolved
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
