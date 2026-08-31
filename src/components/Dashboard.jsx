import { useMemo, useState } from "react";
import { Package, ShieldAlert, Download } from "lucide-react";
import { Card, SectionLabel, Badge, FlagsPanel } from "./ui";
import { LINES } from "../lib/constants";
import { reconciliation, dailyStockReport, profitLossForPeriod } from "../lib/business";
import { fmt } from "../lib/format";
import { toCsv, downloadCsv } from "../lib/csv";

function todayStr() {
  const d = new Date();
  return toDateStr(d);
}
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return toDateStr(date);
}
function startOfMonth(d) {
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), 1));
}

function countBy(arr, key) {
  return arr.reduce((acc, x) => { acc[x[key]] = (acc[x[key]] || 0) + 1; return acc; }, {});
}

// A small set of vertical bars with direct value labels -- built plain (no chart library),
// per the house style: thin bars, rounded data-ends, a hover tooltip, identity by color.
function BarChart({ data, height = 130, money = true }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-6" style={{ height }}>
      {data.map((d, i) => {
        const barH = Math.max(2, (d.value / max) * (height - 40));
        return (
          <div key={i} className="flex flex-col items-center gap-1.5 relative" style={{ width: 56 }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
            {hover === i && (
              <div className="absolute -top-7 px-2 py-1 rounded text-xs text-white whitespace-nowrap z-10" style={{ background: "var(--basalt)" }}>
                {money ? `RWF ${fmt(d.value)}` : fmt(d.value)}
              </div>
            )}
            <div className="text-xs font-mono text-[var(--basalt)]/70">{money ? fmt(d.value) : d.value}</div>
            <div className="w-8 rounded-t" style={{ height: barH, background: d.color, transition: "height 0.3s" }} />
            <div className="text-xs text-[var(--basalt)]/60 text-center">{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Daily trend as a compact bar row — enough bars for a week or a month without crowding;
// direct-labels only the max day plus hover for the rest, since a month of numbers at once is noise.
function TrendChart({ data, color, height = 90 }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => {
        const barH = Math.max(1, (d.total / max) * (height - 24));
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center justify-end gap-1 relative min-w-[3px]"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover((h) => (h === i ? null : h))}>
            {hover === i && (
              <div className="absolute -top-8 px-2 py-1 rounded text-xs text-white whitespace-nowrap z-10" style={{ background: "var(--basalt)" }}>
                {new Date(d.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}: RWF {fmt(d.total)}
              </div>
            )}
            <div className="w-full rounded-t" style={{ height: barH, background: hover === i ? color : color + "aa", transition: "height 0.3s" }} />
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard({ orders, inventory, stockEvents, menu, flags, fixedCosts = [] }) {
  const [rangeKey, setRangeKey] = useState("month");
  const [customStart, setCustomStart] = useState(todayStr());
  const [customEnd, setCustomEnd] = useState(todayStr());

  const { startDate, endDate, rangeLabel } = useMemo(() => {
    const now = new Date();
    if (rangeKey === "today") return { startDate: todayStr(), endDate: todayStr(), rangeLabel: "Today" };
    if (rangeKey === "week") return { startDate: startOfWeek(now), endDate: todayStr(), rangeLabel: "This week" };
    if (rangeKey === "month") return { startDate: startOfMonth(now), endDate: todayStr(), rangeLabel: "This month" };
    return { startDate: customStart, endDate: customEnd, rangeLabel: "Custom range" };
  }, [rangeKey, customStart, customEnd]);

  const pl = useMemo(
    () => profitLossForPeriod(inventory, orders, menu, stockEvents, fixedCosts, startDate, endDate),
    [inventory, orders, menu, stockEvents, fixedCosts, startDate, endDate]
  );

  const pipeline = countBy(orders, "status");
  const lowStock = inventory.filter((i) => i.quantity <= i.reorderLevel);
  const recon = reconciliation(inventory, orders, menu, stockEvents, 30);
  const todayFlagged = dailyStockReport(inventory, orders, menu, stockEvents, todayStr()).filter((r) => r.flagged);

  const revenueByLineChart = pl.revenue.byLine.map((l) => ({ label: LINES[l.line].label, value: l.total, color: LINES[l.line].color }));

  const exportOrders = () => {
    const rangeStart = new Date(startDate).getTime();
    const rangeEnd = new Date(endDate).getTime() + 86400000;
    const billed = orders.filter((o) => {
      if (o.status !== "billed" || !o.billedAt) return false;
      const t = new Date(o.billedAt).getTime();
      return t >= rangeStart && t < rangeEnd;
    });
    const csv = toCsv(billed, [
      { label: "Billed at", get: (o) => new Date(o.billedAt).toLocaleString() },
      { label: "Table/Client", get: (o) => o.tableNumber || o.client },
      { label: "Line", get: (o) => LINES[o.line].label },
      { label: "Staff order", get: (o) => (o.isStaffOrder ? "Yes" : "No") },
      { label: "Total (RWF)", get: (o) => o.total },
      { label: "Payment method", get: (o) => o.paymentMethod || "" },
      { label: "Billed by", get: (o) => o.billedBy || "" },
    ]);
    downloadCsv(`orders_${startDate}_to_${endDate}.csv`, csv);
  };
  const exportSummary = () => {
    const csv = toCsv(
      [
        { label: "Revenue", value: pl.revenue.total },
        { label: "Staff orders (included in revenue)", value: pl.revenue.staffOrders.total },
        { label: "Cost of ingredients used (recorded)", value: pl.recordedCost },
        { label: "Cost of ingredients used (system estimate)", value: pl.expectedCost },
        { label: "Fixed costs", value: pl.fixed.total },
        { label: "Profit / Loss", value: pl.profit },
      ],
      [{ label: "Metric", get: (r) => r.label }, { label: "RWF", get: (r) => r.value }]
    );
    downloadCsv(`summary_${startDate}_to_${endDate}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <SectionLabel>Business health — {rangeLabel}</SectionLabel>
          <button onClick={exportSummary} className="text-xs flex items-center gap-1 text-[var(--basalt)]/60 hover:text-[var(--basalt)]"><Download size={13} /> Download summary (CSV)</button>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {[["today", "Today"], ["week", "This week"], ["month", "This month"], ["custom", "Custom"]].map(([k, label]) => (
            <button key={k} onClick={() => setRangeKey(k)}
              className="text-xs px-3 py-1.5 rounded-full font-medium border"
              style={rangeKey === k
                ? { background: "var(--basalt)", color: "white", borderColor: "var(--basalt)" }
                : { background: "transparent", color: "var(--basalt)", borderColor: "rgba(38,34,29,0.15)" }}>
              {label}
            </button>
          ))}
          {rangeKey === "custom" && (
            <div className="flex items-center gap-2 ml-2">
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="border border-[var(--basalt)]/15 rounded px-2 py-1 text-xs" />
              <span className="text-xs text-[var(--basalt)]/50">to</span>
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="border border-[var(--basalt)]/15 rounded px-2 py-1 text-xs" />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-[var(--basalt)]/50 mb-1">Money in from customers</div>
            <div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>RWF {fmt(pl.revenue.total)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--basalt)]/50 mb-1">Cost of ingredients used</div>
            <div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>RWF {fmt(pl.recordedCost)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--basalt)]/50 mb-1">Fixed costs (rent, salaries, ...)</div>
            <div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>RWF {fmt(pl.fixed.total)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--basalt)]/50 mb-1">{pl.profit >= 0 ? "Profit" : "Loss"}</div>
            <div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: pl.profit >= 0 ? "var(--moss)" : "var(--ember)" }}>
              RWF {fmt(Math.abs(pl.profit))}
            </div>
          </div>
        </div>

        {pl.revenue.staffOrders.count > 0 && (
          <p className="text-xs text-[var(--basalt)]/50 mt-3">
            Includes {pl.revenue.staffOrders.count} staff order{pl.revenue.staffOrders.count === 1 ? "" : "s"} totaling RWF {fmt(pl.revenue.staffOrders.total)} at a reduced price.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <SectionLabel>Money in by area</SectionLabel>
          <BarChart data={revenueByLineChart} />
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-1">
            <SectionLabel>Money in, day by day</SectionLabel>
            <button onClick={exportOrders} className="text-xs flex items-center gap-1 text-[var(--basalt)]/60 hover:text-[var(--basalt)]"><Download size={13} /> Orders (CSV)</button>
          </div>
          {pl.revenue.byDay.length <= 1 ? (
            <p className="text-sm text-[var(--basalt)]/50">Pick a longer range to see a day-by-day trend.</p>
          ) : (
            <TrendChart data={pl.revenue.byDay} color="var(--ember)" />
          )}
        </Card>
      </div>

      <Card>
        <SectionLabel>Ingredient cost — recorded vs. system estimate</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">The system works out roughly what today's orders should have used, based on recipes. The storekeeper separately records what actually went out. Big gaps are worth a look.</p>
        <div className="flex gap-10 flex-wrap">
          <div>
            <div className="text-xs text-[var(--basalt)]/50 mb-1">Storekeeper recorded</div>
            <div className="text-xl font-semibold font-mono">RWF {fmt(pl.recordedCost)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--basalt)]/50 mb-1">System estimate</div>
            <div className="text-xl font-semibold font-mono">RWF {fmt(pl.expectedCost)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--basalt)]/50 mb-1">Difference</div>
            <div className="text-xl font-semibold font-mono" style={{ color: Math.abs(pl.recordedCost - pl.expectedCost) > 0.15 * (pl.expectedCost || 1) ? "var(--ember)" : "inherit" }}>
              RWF {fmt(Math.abs(pl.recordedCost - pl.expectedCost))}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {["placed", "ready", "served", "cancelled"].map((s) => (
          <Card key={s}><SectionLabel>{s}</SectionLabel><div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{pipeline[s] || 0}</div></Card>
        ))}
      </div>

      <FlagsPanel flags={flags} />

      <Card>
        <SectionLabel>Today's flagged items</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Items where what the storekeeper recorded today doesn't match what today's orders imply should've been used.</p>
        {todayFlagged.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">Nothing flagged for today.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
              <th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Recorded out</th><th className="py-2 pr-3">System estimate</th><th className="py-2 pr-3">Variance</th>
            </tr></thead>
            <tbody>
              {todayFlagged.map((r) => (
                <tr key={r.id} className="border-b border-[var(--basalt)]/5" style={{ background: "rgba(181,74,40,0.06)" }}>
                  <td className="py-2 pr-3">{r.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.outByReason.usage} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.expectedOut.toFixed(1)} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs" style={{ color: "var(--ember)", fontWeight: 600 }}>
                    {r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)} {r.unit} <ShieldAlert size={12} className="inline ml-1" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <SectionLabel>Inventory reconciliation — last 30 days</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Compares expected ingredient use (from served orders' recipes) against what storekeepers logged as "usage" stock-out. Large gaps may point to over-portioning, waste, or unrecorded loss.</p>
        {recon.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">No recipe-linked inventory activity yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
              <th className="py-2 pr-3">Ingredient</th><th className="py-2 pr-3">Expected use</th><th className="py-2 pr-3">Actual logged</th><th className="py-2 pr-3">Variance</th><th className="py-2 pr-3">Logged by</th>
            </tr></thead>
            <tbody>
              {recon.map((r) => (
                <tr key={r.name} className="border-b border-[var(--basalt)]/5" style={{ background: r.flagged ? "rgba(181,74,40,0.06)" : "transparent" }}>
                  <td className="py-2 pr-3">{r.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.expected.toFixed(1)} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.actual.toFixed(1)} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs" style={{ color: r.flagged ? "var(--ember)" : "inherit", fontWeight: r.flagged ? 600 : 400 }}>
                    {r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)} {r.unit} {r.flagged && <ShieldAlert size={12} className="inline ml-1" />}
                  </td>
                  <td className="py-2 pr-3 text-xs">{r.loggedBy.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <SectionLabel>Low stock</SectionLabel>
        {lowStock.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">All levels healthy.</p> : (
          <ul className="space-y-1">{lowStock.map((i) => <li key={i.id} className="text-sm flex items-center gap-2"><Package size={13} color="var(--ember)" />{i.name}: {i.quantity} {i.unit} left (reorder at {i.reorderLevel})</li>)}</ul>
        )}
      </Card>
    </div>
  );
}
