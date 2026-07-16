import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, SectionLabel, Badge } from "./ui";
import { LINES } from "../lib/constants";
import { reconciliation } from "../lib/business";
import { fmt } from "../lib/format";

export function InventoryView({ inventory, orders, menu, stockEvents }) {
  const [lineFilter, setLineFilter] = useState("all");
  const recon = reconciliation(inventory, orders, menu, stockEvents, 30);

  const countByLine = useMemo(() => {
    const c = {};
    inventory.forEach((i) => { c[i.line] = (c[i.line] || 0) + 1; });
    return c;
  }, [inventory]);

  const visibleInventory = useMemo(() => {
    const filtered = lineFilter === "all" ? inventory : inventory.filter((i) => i.line === lineFilter);
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [inventory, lineFilter]);

  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Inventory</SectionLabel>
        <div className="flex flex-wrap gap-2 mb-4">
          <button onClick={() => setLineFilter("all")}
            className="text-xs px-3 py-1.5 rounded-full font-medium border"
            style={lineFilter === "all"
              ? { background: "var(--basalt)", color: "white", borderColor: "var(--basalt)" }
              : { background: "transparent", color: "var(--basalt)", borderColor: "rgba(38,34,29,0.15)" }}>
            All ({inventory.length})
          </button>
          {Object.entries(LINES).map(([key, l]) => (
            <button key={key} onClick={() => setLineFilter(key)}
              className="text-xs px-3 py-1.5 rounded-full font-medium border"
              style={lineFilter === key
                ? { background: l.color, color: "white", borderColor: l.color }
                : { background: l.color + "11", color: l.color, borderColor: l.color + "44" }}>
              {l.label} ({countByLine[key] || 0})
            </button>
          ))}
        </div>
        {visibleInventory.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">No items yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Line</th><th className="py-2 pr-3">Quantity</th><th className="py-2 pr-3">Reorder at</th><th className="py-2 pr-3">Value</th></tr></thead>
            <tbody>
              {visibleInventory.map((i) => {
                const low = i.quantity <= i.reorderLevel;
                return (
                  <tr key={i.id} className="border-b border-[var(--basalt)]/5" style={{ background: low ? "rgba(181,74,40,0.06)" : "transparent" }}>
                    <td className="py-2 pr-3">{i.name}</td>
                    <td className="py-2 pr-3"><Badge color={LINES[i.line].color}>{LINES[i.line].label}</Badge></td>
                    <td className="py-2 pr-3 font-mono text-xs" style={{ color: low ? "var(--ember)" : "inherit", fontWeight: low ? 600 : 400 }}>{i.quantity} {i.unit} {low && <AlertTriangle size={12} className="inline ml-1" color="var(--ember)" />}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{i.reorderLevel} {i.unit}</td>
                    <td className="py-2 pr-3 font-mono text-xs">RWF {fmt(i.quantity * i.costPerUnit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <SectionLabel>Usage reconciliation — last 30 days</SectionLabel>
        {recon.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">No recipe-linked activity yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Expected</th><th className="py-2 pr-3">Actual</th><th className="py-2 pr-3">Variance</th></tr></thead>
            <tbody>{recon.map((r) => (
              <tr key={r.name} className="border-b border-[var(--basalt)]/5" style={{ background: r.flagged ? "rgba(181,74,40,0.06)" : "transparent" }}>
                <td className="py-2 pr-3">{r.name}</td><td className="py-2 pr-3 font-mono text-xs">{r.expected.toFixed(1)} {r.unit}</td>
                <td className="py-2 pr-3 font-mono text-xs">{r.actual.toFixed(1)} {r.unit}</td>
                <td className="py-2 pr-3 font-mono text-xs" style={{ color: r.flagged ? "var(--ember)" : "inherit" }}>{r.variance > 0 ? "+" : ""}{r.variance.toFixed(1)} {r.unit}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
