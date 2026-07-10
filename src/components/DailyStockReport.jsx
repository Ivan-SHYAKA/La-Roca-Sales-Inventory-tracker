import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { Card, SectionLabel, Input, FlagsPanel } from "./ui";
import { dailyStockReport, computeStorekeeperAlerts } from "../lib/business";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DailyStockReport({ inventory, orders, menu, stockEvents, session }) {
  const [date, setDate] = useState(todayStr());
  const report = useMemo(() => dailyStockReport(inventory, orders, menu, stockEvents, date), [inventory, orders, menu, stockEvents, date]);
  const alerts = useMemo(() => computeStorekeeperAlerts(orders, menu, inventory), [orders, menu, inventory]);

  const groups = useMemo(() => {
    const byCategory = {};
    report.forEach((r) => {
      const cat = r.category || "Uncategorized";
      (byCategory[cat] ||= []).push(r);
    });
    return Object.entries(byCategory);
  }, [report]);

  return (
    <div className="space-y-6">
      {session.role === "storekeeper" && <FlagsPanel flags={alerts} />}

      <Card>
        <SectionLabel>Daily stock report</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">
          Recorded is what was logged as stock-in/out for the day. System estimate is what the day's served/billed orders imply should've
          been used, calculated from recipes. A flagged row means the two don't line up.
        </p>
        <label className="text-xs text-[var(--basalt)]/60">Date</label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-[180px]" />
      </Card>

      {groups.length === 0 ? (
        <Card><p className="text-sm text-[var(--basalt)]/50">No stock activity or order-driven usage recorded for this day.</p></Card>
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
                <th className="py-2 pr-3">Out (system estimate)</th>
                <th className="py-2 pr-3">Variance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--basalt)]/5" style={{ background: r.flagged ? "rgba(181,74,40,0.06)" : "transparent" }}>
                  <td className="py-2 pr-3">{r.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.opening} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.in} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.out} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.closing} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.missing || 0} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.spoiled || 0} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.expectedOut.toFixed(1)} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs" style={{ color: r.flagged ? "var(--ember)" : "inherit", fontWeight: r.flagged ? 600 : 400 }}>
                    {r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)} {r.unit} {r.flagged && <ShieldAlert size={12} className="inline ml-1" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
