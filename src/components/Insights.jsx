import { useMemo, useState } from "react";
import { Download, Lightbulb } from "lucide-react";
import { Card, SectionLabel, Badge, Select, Input } from "./ui";
import { fmt, humanizeDuration } from "../lib/format";
import { toCsv, downloadCsv } from "../lib/csv";
import { buildSuggestions, forecastDay, predictWait, trainingTable, NEEDS, DAYPARTS } from "../lib/insights";

const SEVERITY = {
  act: { label: "Act now", color: "var(--ember)" },
  watch: { label: "Keep an eye on", color: "var(--gold)" },
  good: { label: "Good", color: "var(--moss)" },
  info: { label: "Note", color: "var(--basalt)" },
  unknown: { label: "Still learning", color: "rgba(38,34,29,0.35)" },
};
const AREA_LABEL = { sales: "Sales", costs: "Costs", speed: "Service speed", stock: "Stock control" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const SHOWN_HOURS = Array.from({ length: 18 }, (_, i) => i + 6); // 06:00 - 23:00
const mins = (m) => humanizeDuration(m * 60000);
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

function Learning({ children }) {
  return <p className="text-sm text-[var(--basalt)]/50">{children}</p>;
}

// Weekday x hour grid: darker = more customers. Plain SVG, same look as the dashboard charts.
function BusyGrid({ grid }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...grid.flat());
  const cell = 24;
  const left = 34;
  return (
    <div className="overflow-x-auto">
      <svg width={left + SHOWN_HOURS.length * cell + 4} height={7 * cell + 26} role="img" aria-label="How busy each hour is, by weekday">
        {SHOWN_HOURS.map((h, c) => (
          <text key={h} x={left + c * cell + cell / 2} y={12} fontSize="9" textAnchor="middle" fill="rgba(38,34,29,0.55)">{h % 2 === 0 ? h : ""}</text>
        ))}
        {WEEK_ORDER.map((wd, r) => (
          <g key={wd}>
            <text x={0} y={26 + r * cell + cell / 2 + 3} fontSize="10" fill="rgba(38,34,29,0.6)">{WEEKDAYS[wd]}</text>
            {SHOWN_HOURS.map((h, c) => {
              const n = grid[wd][h];
              return (
                <rect key={h} x={left + c * cell + 1} y={20 + r * cell + 1} width={cell - 2} height={cell - 2} rx="3"
                  fill={n ? "#B54A28" : "rgba(38,34,29,0.06)"} fillOpacity={n ? 0.15 + 0.85 * (n / max) : 1}
                  stroke={hover === `${wd}-${h}` ? "#26221D" : "none"}
                  onMouseEnter={() => setHover(`${wd}-${h}`)} onMouseLeave={() => setHover(null)}>
                  <title>{`${WEEKDAYS[wd]} ${hh(h)}: ${n} visit${n === 1 ? "" : "s"}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

// Simple vertical bars across the day with the tallest ones labelled.
function HourBars({ values, color = "#B54A28", format = (v) => String(Math.round(v)), height = 110 }) {
  const [hover, setHover] = useState(null);
  const shown = SHOWN_HOURS.map((h) => ({ h, v: values[h] || 0 }));
  const max = Math.max(1e-9, ...shown.map((s) => s.v));
  const top = new Set([...shown].sort((a, b) => b.v - a.v).slice(0, 3).filter((s) => s.v > 0).map((s) => s.h));
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {shown.map(({ h, v }) => (
        <div key={h} className="flex-1 flex flex-col items-center justify-end gap-1 relative min-w-[8px]"
          onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover((x) => (x === h ? null : x))}>
          {hover === h && (
            <div className="absolute -top-7 px-2 py-1 rounded text-xs text-white whitespace-nowrap z-10" style={{ background: "var(--basalt)" }}>
              {hh(h)}: {format(v)}
            </div>
          )}
          {top.has(h) && hover !== h && <div className="text-[10px] font-mono text-[var(--basalt)]/60">{format(v)}</div>}
          <div className="w-full rounded-t" style={{ height: Math.max(2, (v / max) * (height - 34)), background: v ? color : "rgba(38,34,29,0.08)", opacity: hover === h ? 1 : 0.85 }} />
          <div className="text-[10px] text-[var(--basalt)]/50">{h % 2 === 0 ? h : ""}</div>
        </div>
      ))}
    </div>
  );
}

export function Insights({ orders, menu, inventory, stockEvents, fixedCosts = [] }) {
  const result = useMemo(
    () => buildSuggestions({ orders, menu, inventory, stockEvents, fixedCosts }),
    [orders, menu, inventory, stockEvents, fixedCosts]
  );
  const { items, areas, ready, learned, service, demand, runway } = result;

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);
  const forecast = useMemo(() => forecastDay({ orders, targetDate: tomorrow.toISOString() }), [orders, tomorrow]);

  // Ingredients-per-dish picker: only dishes the model has something to say about.
  const dishOptions = useMemo(
    () => Object.keys(learned.byDish).map((id) => ({ id, name: menu.find((m) => m.id === id)?.name || "Unknown dish" })).sort((a, b) => a.name.localeCompare(b.name)),
    [learned, menu]
  );
  const [dishId, setDishId] = useState("");
  const chosenDish = dishId && learned.byDish[dishId] ? dishId : dishOptions[0]?.id;
  const dishRows = chosenDish ? [...learned.byDish[chosenDish]].sort((a, b) => b.learnedQty - a.learnedQty) : [];

  // "How long will this take?" calculator, backed by the learned model.
  const [calcDish, setCalcDish] = useState("");
  const [calcQty, setCalcQty] = useState("1");
  const [calcAhead, setCalcAhead] = useState("0");
  const calcItem = menu.find((m) => m.id === calcDish) || menu.find((m) => m.active !== false);
  const predicted = service.model && calcItem
    ? predictWait(service.model, calcItem.prepMinutes * (Number(calcQty) || 1), Number(calcAhead) || 0)
    : null;

  const exportTraining = () => {
    const t = trainingTable({ orders, menu, inventory, stockEvents });
    const cols = [
      { label: "Date", get: (r) => r.date },
      ...t.dishCols.map((c) => ({ label: `Ordered: ${c}`, get: (r) => r.dishes[c] || 0 })),
      ...t.usageCols.map((c) => ({ label: `Used: ${c}`, get: (r) => Math.round((r.usage[c] || 0) * 1000) / 1000 })),
    ];
    downloadCsv("training_data_daily.csv", toCsv(t.rows, cols));
  };

  const totalLearning = ready.servedOrders === 0;
  const correlated = learned.ingredients.filter((r) => r.correlation != null).sort((a, b) => b.correlation - a.correlation);

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <SectionLabel>Insights &amp; suggestions</SectionLabel>
          <button onClick={exportTraining} className="text-xs flex items-center gap-1 text-[var(--basalt)]/60 hover:text-[var(--basalt)]">
            <Download size={13} /> Download daily data (CSV)
          </button>
        </div>
        <p className="text-sm text-[var(--basalt)]/70">
          {totalLearning
            ? "Nothing to learn from yet. As soon as orders are served and stock-outs are recorded, this page starts working things out and keeps improving as more data comes in."
            : `Learning from ${ready.servedOrders} served order${ready.servedOrders === 1 ? "" : "s"} over ${ready.orderDays} day${ready.orderDays === 1 ? "" : "s"}, and ${ready.usageDays} day${ready.usageDays === 1 ? "" : "s"} of recorded stock-outs. The more days recorded, the more reliable it gets.`}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {Object.keys(AREA_LABEL).map((a) => (
            <div key={a} className="p-3 rounded border border-[var(--basalt)]/10">
              <div className="text-xs text-[var(--basalt)]/50 mb-1">{AREA_LABEL[a]}</div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: SEVERITY[areas[a]].color }} />
                {SEVERITY[areas[a]].label}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionLabel>What to do next</SectionLabel>
        {items.length === 0 ? (
          <Learning>No suggestions yet. They appear once there's something to learn from.</Learning>
        ) : (
          <div className="space-y-3">
            {items.map((s) => (
              <div key={s.id} className="p-3 rounded border border-[var(--basalt)]/10 flex gap-3">
                <Lightbulb size={16} className="shrink-0 mt-0.5" color={SEVERITY[s.severity].color} />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.title}</span>
                    <Badge color={SEVERITY[s.severity].color}>{SEVERITY[s.severity].label}</Badge>
                  </div>
                  <p className="text-sm text-[var(--basalt)]/70 mt-1">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <SectionLabel>Ingredients per order</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">
          Compares what each dish's recipe says with what the stock records show it really uses, worked out from the days when both orders and stock-outs were recorded.
        </p>
        {learned.nDays < NEEDS.ingredientDays ? (
          <Learning>Needs {NEEDS.ingredientDays} days with both orders and recorded stock-outs. {learned.nDays} so far.</Learning>
        ) : (
          <>
            <div className="max-w-xs mb-3">
              <label className="text-xs text-[var(--basalt)]/60">Dish</label>
              <Select value={chosenDish || ""} onChange={(e) => setDishId(e.target.value)}>
                {dishOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
                <th className="py-2 pr-3">Ingredient</th><th className="py-2 pr-3">Recipe says</th><th className="py-2 pr-3">Records show</th><th className="py-2 pr-3">Difference</th><th className="py-2 pr-3">Confidence</th>
              </tr></thead>
              <tbody>
                {dishRows.map((r) => {
                  const big = r.changePct != null && Math.abs(r.changePct) > 0.2 && r.confidence === "good";
                  return (
                    <tr key={r.invId} className="border-b border-[var(--basalt)]/5">
                      <td className="py-2 pr-3">{r.ingredient}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.recipeQty ? `${+r.recipeQty.toFixed(3)} ${r.unit}` : "not listed"}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{+r.learnedQty.toFixed(3)} {r.unit}</td>
                      <td className="py-2 pr-3 font-mono text-xs" style={{ color: big ? "var(--ember)" : "inherit", fontWeight: big ? 600 : 400 }}>
                        {r.changePct == null ? "—" : `${r.changePct > 0 ? "+" : ""}${Math.round(r.changePct * 100)}%`}
                      </td>
                      <td className="py-2 pr-3 text-xs text-[var(--basalt)]/60">{r.confidence === "good" ? "Good" : "Low (few orders)"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="mt-5 text-xs uppercase tracking-wide text-[var(--basalt)]/50 mb-2">How closely stock-out follows orders</div>
            {correlated.length === 0 ? <Learning>Not enough variety in the data yet.</Learning> : (
              <div className="space-y-1.5">
                {correlated.slice(0, 10).map((r) => (
                  <div key={r.invId} className="flex items-center gap-3 text-sm">
                    <div className="w-40 truncate">{r.name}</div>
                    <div className="flex-1 h-2 rounded-full bg-[var(--basalt)]/10 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, r.correlation * 100)}%`, background: r.correlation > 0.7 ? "var(--moss)" : r.correlation > 0.4 ? "var(--gold)" : "var(--ember)" }} />
                    </div>
                    <div className="w-12 text-right font-mono text-xs">{Math.round(r.correlation * 100)}%</div>
                  </div>
                ))}
                <p className="text-xs text-[var(--basalt)]/50 pt-1">100% means the amount taken out of stock rises and falls exactly with orders. A low number means stock is leaving for reasons orders don't explain.</p>
              </div>
            )}
          </>
        )}
      </Card>

      <Card>
        <SectionLabel>How long orders take</SectionLabel>
        {service.n < NEEDS.serviceOrders ? (
          <Learning>Needs {NEEDS.serviceOrders} completed orders (marked ready, then served). {service.n} so far.</Learning>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div><div className="text-xs text-[var(--basalt)]/50 mb-1">Average, order to table</div><div className="text-xl font-semibold font-mono">{mins(service.overall.mean)}</div></div>
              <div><div className="text-xs text-[var(--basalt)]/50 mb-1">Slowest 1 in 10 takes</div><div className="text-xl font-semibold font-mono">{mins(service.overall.p90)}</div></div>
              <div><div className="text-xs text-[var(--basalt)]/50 mb-1">Kitchen / bar part</div><div className="text-xl font-semibold font-mono">{service.kitchen ? mins(service.kitchen.mean) : "—"}</div></div>
              <div><div className="text-xs text-[var(--basalt)]/50 mb-1">Waiting to be served</div><div className="text-xl font-semibold font-mono">{service.delivery ? mins(service.delivery.mean) : "—"}</div></div>
            </div>
            <div className="text-xs uppercase tracking-wide text-[var(--basalt)]/50 mb-2">Average time by hour the order was placed (minutes)</div>
            <HourBars values={Object.fromEntries(service.byHour.map((h) => [h.hour, h.mean]))} color="#46583F" format={(v) => `${Math.round(v)} min`} />
            {service.slowDishes.length > 0 && (
              <p className="text-sm text-[var(--basalt)]/70 mt-4">
                Slowest to arrive: {service.slowDishes.map((d) => `${d.dish} (${mins(d.mean)})`).join(", ")}.
              </p>
            )}
            {service.model ? (
              <div className="mt-5 p-3 rounded bg-[var(--basalt)]/[0.03]">
                <div className="text-sm font-medium mb-1">Predict a wait</div>
                <p className="text-xs text-[var(--basalt)]/60 mb-3">
                  From past orders: each minute of prep time adds about {service.model.perPrepMinute.toFixed(1)} min, and each order already waiting adds about {service.model.perOrderAhead.toFixed(1)} min.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-48"><label className="text-xs text-[var(--basalt)]/60">Dish</label>
                    <Select value={calcItem?.id || ""} onChange={(e) => setCalcDish(e.target.value)}>
                      {menu.filter((m) => m.active !== false).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                  </div>
                  <div className="w-20"><label className="text-xs text-[var(--basalt)]/60">How many</label><Input type="number" min="1" value={calcQty} onChange={(e) => setCalcQty(e.target.value)} /></div>
                  <div className="w-32"><label className="text-xs text-[var(--basalt)]/60">Orders waiting</label><Input type="number" min="0" value={calcAhead} onChange={(e) => setCalcAhead(e.target.value)} /></div>
                  <div className="text-lg font-semibold font-mono pb-1">{predicted != null ? `≈ ${mins(predicted)}` : "—"}</div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>

      <Card>
        <SectionLabel>When customers order, and what</SectionLabel>
        {demand.visits < NEEDS.demandOrders || demand.days < NEEDS.demandDays ? (
          <Learning>Needs {NEEDS.demandOrders} orders across {NEEDS.demandDays} days. {demand.visits} order{demand.visits === 1 ? "" : "s"} over {demand.days} day{demand.days === 1 ? "" : "s"} so far.</Learning>
        ) : (
          <>
            <div className="text-xs uppercase tracking-wide text-[var(--basalt)]/50 mb-2">Busy times (darker = more customers)</div>
            <BusyGrid grid={demand.grid} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--basalt)]/50 mb-2">Most ordered, by time of day</div>
                <div className="space-y-2">
                  {DAYPARTS.map((p) => (
                    <div key={p.key} className="text-sm">
                      <span className="text-[var(--basalt)]/60">{p.label}: </span>
                      {demand.byDaypart[p.key].length ? demand.byDaypart[p.key].map((i) => `${i.name} (${i.qty})`).join(", ") : <span className="text-[var(--basalt)]/40">no orders</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-[var(--basalt)]/50 mb-2">Often ordered together</div>
                {demand.pairs.length === 0 ? <Learning>No clear pairs yet.</Learning> : (
                  <ul className="space-y-1 text-sm">
                    {demand.pairs.map((p, i) => (
                      <li key={i}>{p.a} + {p.b} <span className="text-xs text-[var(--basalt)]/50">({p.count} times{p.lift > 1.2 ? ", more than chance" : ""})</span></li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-6">
              <div className="text-xs uppercase tracking-wide text-[var(--basalt)]/50 mb-1">
                Expected tomorrow ({tomorrow.toLocaleDateString(undefined, { weekday: "long" })}): orders per hour
              </div>
              {forecast ? (
                <>
                  <p className="text-xs text-[var(--basalt)]/50 mb-3">
                    About {Math.round(forecast.hours.reduce((s, h) => s + h, 0))} orders expected, based on {forecast.basedOnDays} past {forecast.sameWeekday ? `${tomorrow.toLocaleDateString(undefined, { weekday: "long" })}s` : "days"}, recent weeks counting more.
                  </p>
                  <HourBars values={forecast.hours} format={(v) => v.toFixed(1)} />
                </>
              ) : <Learning>Not enough days of history yet.</Learning>}
            </div>
          </>
        )}
      </Card>

      <Card>
        <SectionLabel>Stock likely to run out</SectionLabel>
        {ready.usageDays < NEEDS.runwayDays ? (
          <Learning>Needs {NEEDS.runwayDays} days of recorded stock-outs. {ready.usageDays} so far.</Learning>
        ) : runway.length === 0 ? (
          <Learning>Nothing recorded as used recently.</Learning>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10">
              <th className="py-2 pr-3">Item</th><th className="py-2 pr-3">In stock</th><th className="py-2 pr-3">Used per day</th><th className="py-2 pr-3">Lasts about</th>
            </tr></thead>
            <tbody>
              {runway.slice(0, 10).map((r) => (
                <tr key={r.invId} className="border-b border-[var(--basalt)]/5">
                  <td className="py-2 pr-3">{r.name}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{fmt(r.quantity)} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{r.perDay.toFixed(2)} {r.unit}</td>
                  <td className="py-2 pr-3 font-mono text-xs" style={{ color: r.daysLeft < 3 ? "var(--ember)" : "inherit", fontWeight: r.daysLeft < 3 ? 600 : 400 }}>
                    {r.daysLeft < 1 ? "less than a day" : `${Math.round(r.daysLeft)} days`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
