import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Card, SectionLabel, Input } from "./ui";
import { humanizeDuration } from "../lib/format";
import { resolveStockAlert } from "../lib/data";

// Everything that is currently low, in one place instead of on top of every screen. Grouped
// under the stock-sheet headings, with the item's live quantity (the alert text can be older).
export function StockAlertsPanel({ alerts, inventory, canResolve, refresh, onError }) {
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const invMap = useMemo(() => Object.fromEntries(inventory.map((i) => [i.id, i])), [inventory]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return alerts
      .map((a) => ({ alert: a, item: invMap[a.invId] }))
      .filter(({ alert, item }) => !q || (item?.name || alert.message).toLowerCase().includes(q))
      .sort((x, y) => (x.item?.name || x.alert.message).localeCompare(y.item?.name || y.alert.message));
  }, [alerts, invMap, search]);

  const groups = useMemo(() => {
    const by = {};
    rows.forEach((r) => (by[r.item?.category || "Other items"] ||= []).push(r));
    return Object.entries(by).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const resolve = async (id) => {
    setBusyId(id);
    try {
      await resolveStockAlert(id);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't resolve the alert — check your connection and try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <Card>
        <SectionLabel>Stock alerts ({alerts.length})</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Items at or below their reorder level. An item clears from this list by itself once it is restocked above that level.</p>
        {alerts.length > 8 && <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find an item…" className="max-w-xs" />}
        {alerts.length === 0 && <p className="text-sm text-[var(--basalt)]/50 flex items-center gap-2"><CheckCircle2 size={16} /> Nothing is low right now.</p>}
      </Card>

      {groups.map(([category, items]) => (
        <Card key={category} className="!p-0 overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide bg-[var(--basalt)]/[0.04] border-b border-[var(--basalt)]/10">{category} ({items.length})</div>
          <ul>
            {items.map(({ alert, item }) => (
              <li key={alert.id} className="px-4 py-2.5 border-b border-[var(--basalt)]/5 last:border-0 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words">{item?.name || alert.message}</div>
                  <div className="text-xs text-[var(--basalt)]/60">
                    {item ? <><span style={{ color: "var(--ember)", fontWeight: 600 }}>{item.quantity} {item.unit} left</span>{item.reorderLevel > 0 ? ` · reorder at ${item.reorderLevel}` : " · no reorder level set"}</> : null}
                    {" · "}{humanizeDuration(Date.now() - new Date(alert.createdAt).getTime())} ago
                  </div>
                </div>
                {canResolve && (
                  <button onClick={() => resolve(alert.id)} disabled={busyId === alert.id}
                    className="text-xs px-2.5 py-1 rounded border border-[var(--basalt)]/20 shrink-0 hover:bg-[var(--basalt)]/5 disabled:opacity-50">
                    Mark resolved
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
