import { Package, ShieldAlert } from "lucide-react";
import { Card, SectionLabel, Badge, FlagsPanel } from "./ui";
import { LINES } from "../lib/constants";
import { reconciliation } from "../lib/business";
import { fmt } from "../lib/format";

function countBy(arr, key) {
  return arr.reduce((acc, x) => { acc[x[key]] = (acc[x[key]] || 0) + 1; return acc; }, {});
}

export function Dashboard({ orders, inventory, stockEvents, menu, flags }) {
  const billed = orders.filter((o) => o.status === "billed");
  const revenue = billed.reduce((s, o) => s + o.total, 0);
  const revenueByLine = Object.keys(LINES).map((k) => ({ key: k, label: LINES[k].label, color: LINES[k].color, value: billed.filter((o) => o.line === k).reduce((s, o) => s + o.total, 0) }));
  const pipeline = countBy(orders, "status");
  const lowStock = inventory.filter((i) => i.quantity <= i.reorderLevel);
  const recon = reconciliation(inventory, orders, menu, stockEvents, 30);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card><SectionLabel>Billed revenue</SectionLabel><div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>RWF {fmt(revenue)}</div></Card>
        {["placed", "ready", "served", "cancelled"].map((s) => (
          <Card key={s}><SectionLabel>{s}</SectionLabel><div className="text-2xl font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{pipeline[s] || 0}</div></Card>
        ))}
      </div>

      <Card>
        <SectionLabel>Revenue by line</SectionLabel>
        <div className="flex gap-6 flex-wrap">
          {revenueByLine.map((s) => <div key={s.key}><div className="text-xs text-[var(--basalt)]/50">{s.label}</div><div className="font-mono font-semibold" style={{ color: s.color }}>RWF {fmt(s.value)}</div></div>)}
        </div>
      </Card>

      <FlagsPanel flags={flags} />

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
