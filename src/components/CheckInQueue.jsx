import { useState, useMemo } from "react";
import { CheckCircle2, Info } from "lucide-react";
import { Card, SectionLabel, Input, Select, PrimaryBtn, Req, MissingHint } from "./ui";
import { isBlank } from "../lib/validate";
import { OrderDetailsModal } from "./OrderDetails";
import { orderLabel } from "../lib/format";
import { checkInOrder } from "../lib/data";

export function CheckInQueue({ orders, menu, inventory, session, refresh, onError }) {
  const [active, setActive] = useState(null);
  const [detailsOrder, setDetailsOrder] = useState(null);
  const queue = orders.filter((o) => o.line === "accommodations" && o.status === "placed").sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));

  const confirm = async (order, guestDetails, amenities) => {
    try {
      await checkInOrder(order, session, guestDetails, amenities);
      setActive(null);
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't complete check-in — check your connection and try again.");
      throw e;
    }
  };

  return (
    <Card>
      {active && <CheckInModal order={active} menu={menu} inventory={inventory} onClose={() => setActive(null)} onConfirm={confirm} />}
      {detailsOrder && <OrderDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />}
      <SectionLabel>Check-in queue ({queue.length})</SectionLabel>
      <p className="text-xs text-[var(--basalt)]/50 mb-3">Amenities confirmed here are logged against inventory for reconciliation only — they don't add to the guest's bill, since the room rate already covers them.</p>
      {queue.length === 0 ? <p className="text-sm text-[var(--basalt)]/50 flex items-center gap-2"><CheckCircle2 size={16} /> No bookings waiting on check-in.</p> : (
        <div className="space-y-3">
          {queue.map((o) => (
            <div key={o.id} className="flex items-center justify-between p-3 rounded border border-[var(--basalt)]/10">
              <div>
                <button onClick={() => setDetailsOrder(o)} className="font-medium text-sm flex items-center gap-1 hover:underline">
                  {orderLabel(o)} <Info size={11} className="text-[var(--basalt)]/30" /> <span className="text-xs text-[var(--basalt)]/40 font-normal">· booked by {o.placedBy}</span>
                </button>
                <div className="text-xs text-[var(--basalt)]/60 mt-1">{o.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}</div>
              </div>
              <PrimaryBtn color="var(--gold)" onClick={() => setActive(o)}>Check in</PrimaryBtn>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CheckInModal({ order, menu, inventory, onClose, onConfirm }) {
  const invMap = useMemo(() => Object.fromEntries(inventory.map((i) => [i.id, i])), [inventory]);
  const defaultAmenities = useMemo(() => {
    const totals = {};
    order.items.forEach((it) => {
      const m = menu.find((mm) => mm.id === it.menuId);
      (m?.recipe || []).forEach((r) => { totals[r.invId] = (totals[r.invId] || 0) + r.qty * it.qty; });
    });
    return Object.entries(totals).map(([invId, qty]) => ({ invId, qty }));
  }, [order, menu]);

  const [guest, setGuest] = useState({ idType: "National ID", idNumber: "", nationality: "", purpose: "" });
  const [amenities, setAmenities] = useState(defaultAmenities);
  const [busy, setBusy] = useState(false);
  // Guest registry details are a legal requirement, so ID and nationality can't be left out.
  const problems = [];
  if (isBlank(guest.idNumber)) problems.push("ID number");
  if (isBlank(guest.nationality)) problems.push("nationality");
  if (amenities.some((a) => !(Number(a.qty) >= 0))) problems.push("an amount (0 or more) for each amenity");
  const updateAmenity = (invId, qty) => setAmenities((a) => a.map((x) => x.invId === invId ? { ...x, qty: Number(qty) } : x));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <SectionLabel>Check in — {orderLabel(order)}</SectionLabel>
        <p className="text-xs text-[var(--basalt)]/50 mb-3">Guest registry details (kept for regulatory/government compliance).</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs text-[var(--basalt)]/60">ID type<Req /></label>
            <Select value={guest.idType} onChange={(e) => setGuest({ ...guest, idType: e.target.value })}>
              <option>National ID</option><option>Passport</option><option>Driving Licence</option><option>Other</option>
            </Select>
          </div>
          <div><label className="text-xs text-[var(--basalt)]/60">ID number<Req /></label><Input value={guest.idNumber} onChange={(e) => setGuest({ ...guest, idNumber: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Nationality<Req /></label><Input value={guest.nationality} onChange={(e) => setGuest({ ...guest, nationality: e.target.value })} /></div>
          <div><label className="text-xs text-[var(--basalt)]/60">Purpose of stay</label><Input value={guest.purpose} onChange={(e) => setGuest({ ...guest, purpose: e.target.value })} /></div>
        </div>

        <p className="text-xs text-[var(--basalt)]/60 mt-4 mb-2">Amenities to issue (from the room's recipe — adjust if needed)</p>
        {amenities.length === 0 ? <p className="text-xs text-[var(--basalt)]/40">No amenities linked to this room type yet — set them up in Menu & Recipes.</p> : (
          <div className="space-y-2">
            {amenities.map((a) => (
              <div key={a.invId} className="flex items-center justify-between text-sm">
                <span>{invMap[a.invId]?.name || "—"}</span>
                <Input type="number" value={a.qty} onChange={(e) => updateAmenity(a.invId, e.target.value)} className="w-20 mt-0" />
              </div>
            ))}
          </div>
        )}

        <MissingHint items={problems} className="mt-4" />
        <div className="flex gap-2 mt-3">
          <PrimaryBtn color="var(--moss)" disabled={busy || problems.length > 0} onClick={async () => {
            setBusy(true);
            try { await onConfirm(order, guest, amenities); } catch (e) { /* surfaced via onError above */ } finally { setBusy(false); }
          }}>Confirm check-in</PrimaryBtn>
          <button onClick={onClose} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Cancel</button>
        </div>
      </Card>
    </div>
  );
}
