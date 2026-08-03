import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Card, SectionLabel, Input, FlagsPanel, StatusBadge, Badge } from "./ui";
import { dailyStockReport, computeStorekeeperAlerts, ordersForStorekeeperLog } from "../lib/business";
import { LINES } from "../lib/constants";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DailyStockReport({ inventory, orders, menu, stockEvents, session }) {
  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const report = useMemo(() => dailyStockReport(inventory, orders, menu, stockEvents, date), [inventory, orders, menu, stockEvents, date]);
  const alerts = useMemo(() => computeStorekeeperAlerts(orders, menu, inventory), [orders, menu, inventory]);
  const orderLog = useMemo(() => ordersForStorekeeperLog(orders, menu, inventory, date), [orders, menu, inventory, date]);
  const isManager = session.role === "manager";

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? report.filter((r) => r.name.toLowerCase().includes(q)) : report;
    const byCategory = {};
    filtered.forEach((r) => {
      const cat = r.category || "Uncategorized";
      (byCategory[cat] ||= []).push(r);
    });
    return Object.entries(byCategory).map(([cat, rows]) => [cat, [...rows].sort((a, b) => a.name.localeCompare(b.name))]);
  }, [report, search]);

  return (
    <div className="space-y-6">
      {session.role === "storekeeper" && <FlagsPanel flags={alerts} />}

      <Card>
        <SectionLabel>Daily stock report</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">
          {isManager
            ? "Recorded is what the storekeeper logged as stock-in/out for the day. System estimate is what the day's served/billed orders imply should've been used, calculated from recipes. A flagged row means the two don't line up."
            : "What you've logged as stock-in/out for the day. Only you (via Stock In / Stock Out) change these numbers — orders no longer deduct stock automatically."}
        </p>
        <div className="flex flex-wrap gap-3 items-end">
          <div><label className="text-xs text-[var(--basalt)]/60">Date</label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[180px]" /></div>
          <div className="flex-1 min-w-[180px]"><label className="text-xs text-[var(--basalt)]/60">Search item</label><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name…" /></div>
        </div>
      </Card>

      <Card>
        <SectionLabel>Orders — ingredients to pull ({orderLog.length})</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">
          Every order placed this day, grouped as one entry per order regardless of whether it spans restaurant and coffee shop —
          kept here for reference even after the order's ingredients notification has cleared.
        </p>
        {orderLog.length === 0 ? (
          <p className="text-sm text-[var(--basalt)]/50">No recipe-linked orders placed this day.</p>
        ) : (
          <div className="space-y-3">
            {orderLog.map((g) => (
              <div key={g.key} className="p-3 rounded border border-[var(--basalt)]/10">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="text-sm font-medium">{g.label}</div>
                  <div className="flex items-center gap-2 text-xs text-[var(--basalt)]/50">
                    <span>{new Date(g.placedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span>· placed by {g.placedBy || "—"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {g.lines.map((l, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <Badge color={LINES[l.line].color}>{LINES[l.line].label}</Badge>
                      <StatusBadge status={l.status} />
                    </span>
                  ))}
                </div>
                <div className="text-xs text-[var(--basalt)]/70">
                  {g.ingredients.map((i) => `${i.qty} ${i.unit} ${i.name}`).join(", ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {groups.length === 0 ? (
        <Card><p className="text-sm text-[var(--basalt)]/50">No stock activity recorded for this day.</p></Card>
      ) : groups.map(([category, rows]) => (
        <Card key={category}>
          <SectionLabel>{category}</SectionLabel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">Opening</th>
                <th className="py-2 pr-3">In</th>
                <th className="py-2 pr-3">Out (recorded)</th>
                <th className="py-2 pr-3">Closing</th>
                <th className="py-2 pr-3">Missing</th>
                <th className="py-2 pr-3">Spoiled</th>
                {isManager && <th className="py-2 pr-3">Out (system estimate)</th>}
                {isManager && <th className="py-2 pr-3">Variance</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--basalt)]/5" style={{ background: isManager && r.flagged ? "rgba(181,74,40,0.06)" : "transparent" }}>
                  <td className="py-2 pr-3">{r.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.opening} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.in} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.out} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.closing} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.missing || 0} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.spoiled || 0} {r.unit}</td>
                  {isManager && <td className="py-2 pr-3 font-mono text-xs">{r.expectedOut.toFixed(1)} {r.unit}</td>}
                  {isManager && (
                    <td className="py-2 pr-3 font-mono text-xs" style={{ color: r.flagged ? "var(--ember)" : "inherit", fontWeight: r.flagged ? 600 : 400 }}>
                      {r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)} {r.unit} {r.flagged && <ShieldAlert size={12} className="inline ml-1" />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
