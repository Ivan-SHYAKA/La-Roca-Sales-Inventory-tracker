import { AlertTriangle } from "lucide-react";
import { Card, SectionLabel, Badge } from "./ui";
import { LINES } from "../lib/constants";
import { reconciliation } from "../lib/business";
import { fmt } from "../lib/format";

export function InventoryView({ inventory, orders, menu, stockEvents }) {
  const recon = reconciliation(inventory, orders, menu, stockEvents, 30);
  return (
    <div className="space-y-6">
      <Card>
        <SectionLabel>Inventory</SectionLabel>
        {inventory.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">No items yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-[var(--basalt)]/50 border-b border-[var(--basalt)]/10"><th className="py-2 pr-3">Item</th><th className="py-2 pr-3">Line</th><th className="py-2 pr-3">Quantity</th><th className="py-2 pr-3">Reorder at</th><th className="py-2 pr-3">Value</th></tr></thead>
            <tbody>
              {inventory.map((i) => {
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
