import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Card, SectionLabel, Badge } from "./ui";
import { LINES } from "../lib/constants";
import { reconciliation, dailyStockReport, profitLossForPeriod } from "../lib/business";
import { fmt } from "../lib/format";
import { paymentsOf, paymentText, methodLabel } from "../lib/payments";
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

// "Needs attention": a row of small counters instead of long lists on the dashboard. Tapping a
// counter either opens the screen that holds the full list (low stock) or unfolds a short
// preview right underneath (everything else). The dashboard itself stays a few lines tall.
function AttentionSummary({ tiles }) {
  const [open, setOpen] = useState(null);
  const active = tiles.find((t) => t.key === open && !t.goTo);
  return (
    <Card>
      <SectionLabel>Needs attention</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <button key={t.key} onClick={() => (t.goTo ? t.goTo() : setOpen(open === t.key ? null : t.key))}
            className="text-left p-3 rounded-md border-2"
            style={{ borderColor: open === t.key ? "var(--basalt)" : t.count > 0 ? "rgba(181,74,40,0.35)" : "rgba(38,34,29,0.12)", background: "white" }}>
            <div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: t.count > 0 ? "var(--ember)" : "var(--moss)" }}>{t.count}</div>
            <div className="text-xs font-medium mt-0.5">{t.label}</div>
            <div className="text-[11px] text-[var(--basalt)]/45 mt-0.5">{t.count > 0 ? t.hint : "All clear"}</div>
          </button>
        ))}
      </div>
      {active && active.count > 0 && <div className="mt-3 max-h-64 overflow-y-auto border-t border-[var(--basalt)]/10 pt-3">{active.render()}</div>}
    </Card>
  );
}

export function Dashboard({ orders, inventory, stockEvents, menu, flags, fixedCosts = [], stockAlertCount = 0, goTo }) {
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
  // Placed / ready / served / cancelled are "right now" counts. Billed only ever grows, so it
  // is counted for the period chosen above (today, this week, this month, or a custom range).
  const billedInPeriod = useMemo(() => {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime() + 86400000;
    const billed = orders.filter((o) => {
      if (o.status !== "billed" || !o.billedAt) return false;
      const t = new Date(o.billedAt).getTime();
      return t >= start && t < end;
    });
    return { count: billed.length, amount: billed.reduce((sum, o) => sum + o.total, 0) };
  }, [orders, startDate, endDate]);
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
      { label: "Payment method", get: (o) => (paymentsOf(o).length > 1 ? paymentText(paymentsOf(o), fmt) : methodLabel(o.paymentMethod) || "") },
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {["placed", "ready", "served"].map((s) => (
          <Card key={s}><SectionLabel>{s}</SectionLabel><div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{pipeline[s] || 0}</div></Card>
        ))}
        <Card>
          <SectionLabel>billed</SectionLabel>
          <div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{billedInPeriod.count}</div>
          <div className="text-xs text-[var(--basalt)]/50 mt-1">{rangeLabel.toLowerCase()} · RWF {fmt(billedInPeriod.amount)}</div>
        </Card>
        <Card><SectionLabel>cancelled</SectionLabel><div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{pipeline.cancelled || 0}</div></Card>
      </div>

      <AttentionSummary tiles={[
        { key: "low", label: "Low stock", count: stockAlertCount, hint: "Open the list", goTo: goTo ? () => goTo("stockalerts") : null },
        {
          key: "flags", label: "Operational flags", count: flags.length, hint: "Show details",
          render: () => (
            <ul className="space-y-1.5">
              {flags.slice(0, 8).map((f) => <li key={f.id} className="text-sm flex gap-2"><Badge color={f.severity === "high" ? "#B54A28" : "#B8923F"}>{f.role}</Badge><span>{f.msg}</span></li>)}
              {flags.length > 8 && <li className="text-xs text-[var(--basalt)]/50">and {flags.length - 8} more</li>}
            </ul>
          ),
        },
        {
          key: "today", label: "Stock differences today", count: todayFlagged.length, hint: "Show details",
          render: () => (
            <ul className="space-y-1.5">
              {todayFlagged.slice(0, 8).map((r) => (
                <li key={r.id} className="text-sm flex flex-wrap gap-x-3">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-[var(--basalt)]/60 font-mono">recorded {r.out} {r.unit} · system {r.expectedOut.toFixed(1)} {r.unit} · {r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          ),
        },
        {
          key: "recon", label: "Usage gaps (30 days)", count: recon.filter((r) => r.flagged).length, hint: "Show details",
          render: () => (
            <div>
              <ul className="space-y-1.5">
                {recon.filter((r) => r.flagged).slice(0, 8).map((r) => (
                  <li key={r.name} className="text-sm flex flex-wrap gap-x-3">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-[var(--basalt)]/60 font-mono">expected {r.expected.toFixed(1)} · recorded {r.actual.toFixed(1)} {r.unit} · {r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)}</span>
                  </li>
                ))}
              </ul>
              {goTo && <button onClick={() => goTo("inventory")} className="text-xs underline text-[var(--basalt)]/60 mt-2">Full table in Inventory</button>}
            </div>
          ),
        },
      ]} />
    </div>
  );
}
