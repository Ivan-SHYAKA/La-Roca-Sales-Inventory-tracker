import { useState, useEffect, useMemo } from "react";
import { Plus, Minus, Trash2, CheckCircle2, Search, Maximize2, X, Info } from "lucide-react";
import { Card, SectionLabel, Input, PrimaryBtn, StatusBadge, FlagsPanel, Req, MissingHint } from "./ui";
import { isNonNegative } from "../lib/validate";
import { OrderDetailsModal } from "./OrderDetails";
import { LINES, TABLE_SECTIONS } from "../lib/constants";
import { fmt, orderLabel } from "../lib/format";
import { draftGet, draftSet, draftClear } from "../lib/draft";
import { placeOrder } from "../lib/data";
import { groupOrdersByGroupId } from "../lib/business";

const TABLE_LABEL = { restaurant: "Table number", coffeeshop: "Table number", accommodations: "Room number" };

export function NewOrder({ menu, orders, session, refresh, onError, flags = [] }) {
  const draftKey = `lr-draft-${session.username}`;
  const [client, setClient] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [billChoice, setBillChoice] = useState(""); // "" = not chosen, "new", or an open bill's group id
  const [phone, setPhone] = useState("");
  const [line, setLine] = useState("restaurant"); // which category tab is currently being browsed
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]); // items can come from any line — split into per-line orders on submit
  const [busy, setBusy] = useState(false);
  const [justPlaced, setJustPlaced] = useState(null);
  const [kiosk, setKiosk] = useState(false);
  const [detailsOrder, setDetailsOrder] = useState(null);
  const [isStaffOrder, setIsStaffOrder] = useState(false);
  const [staffTotal, setStaffTotal] = useState("");

  // Resume any in-progress order this user was building if the page reloaded (power/internet drop).
  useEffect(() => {
    const d = draftGet(draftKey);
    if (d) { setClient(d.client || ""); setTableNumber(d.tableNumber || ""); setPhone(d.phone || ""); setLine(d.line || "restaurant"); setCart(d.cart || []); }
  }, []);
  useEffect(() => { draftSet(draftKey, { client, tableNumber, phone, line, cart }); }, [client, tableNumber, phone, line, cart]);
  // A different table means a different set of open bills, so the choice starts again.
  useEffect(() => { setBillChoice(""); }, [tableNumber]);

  useEffect(() => {
    if (!justPlaced) return;
    const t = setTimeout(() => setJustPlaced(null), 6000);
    return () => clearTimeout(t);
  }, [justPlaced]);

  const availableItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menu.filter((m) => m.line === line && m.active !== false && (!q || m.name.toLowerCase().includes(q)));
  }, [menu, line, search]);

  const cartQty = (menuId) => cart.find((x) => x.menuId === menuId)?.qty || 0;
  const addToCart = (m) => setCart((c) => {
    const existing = c.find((x) => x.menuId === m.id);
    if (existing) return c.map((x) => x.menuId === m.id ? { ...x, qty: x.qty + 1 } : x);
    return [...c, { menuId: m.id, name: m.name, price: m.price, prepMinutes: m.prepMinutes, line: m.line, qty: 1 }];
  });
  const setQty = (menuId, qty) => setCart((c) => {
    if (qty <= 0) return c.filter((x) => x.menuId !== menuId);
    return c.map((x) => x.menuId === menuId ? { ...x, qty } : x);
  });
  const removeFromCart = (menuId) => setCart((c) => c.filter((x) => x.menuId !== menuId));
  const total = cart.reduce((s, x) => s + x.price * x.qty, 0);
  const itemCount = cart.reduce((s, x) => s + x.qty, 0);

  // "Mine" regardless of role: waiters only ever see their own placed orders anyway (RLS),
  // sales/manager see everyone's — this narrows it to just what this person has been placing.
  // Grouped by groupId (falling back to a singleton group for older orders placed before
  // that column existed) so a table's mixed-line order shows as one card here too, instead
  // of once per department.
  const myOrderGroups = useMemo(() => {
    const mine = (orders || []).filter((o) => o.placedById === session.id);
    return groupOrdersByGroupId(mine)
      .map((g) => ({
        key: g.map((o) => o.id).sort().join("-"),
        orders: g,
        placedAt: g.map((o) => o.placedAt).sort()[0],
        total: g.reduce((s, o) => s + o.total, 0),
      }))
      .sort((a, b) => new Date(b.placedAt) - new Date(a.placedAt))
      .slice(0, 8);
  }, [orders, session.id]);

  // Everything that has to be in place before an order can be sent.
  // Open (not yet billed) bills at this table that this order could be added to. Each bill is
  // one customer's orders; adding to the wrong one would mix two customers' invoices, so the
  // waiter has to choose when there is more than one option.
  const openBills = useMemo(() => {
    const t = tableNumber.trim().toLowerCase();
    if (!t) return [];
    const by = new Map();
    (orders || [])
      .filter((o) => o.groupId && (o.tableNumber || "").toLowerCase() === t && ["placed", "ready", "served"].includes(o.status))
      .forEach((o) => {
        const g = by.get(o.groupId) || { groupId: o.groupId, client: "", phone: "", total: 0, itemCount: 0, placedAt: o.placedAt };
        g.total += o.total;
        g.itemCount += o.items.reduce((s, i) => s + i.qty, 0);
        if (!g.client && o.client) g.client = o.client;
        if (!g.phone && o.phone) g.phone = o.phone;
        if (new Date(o.placedAt) < new Date(g.placedAt)) g.placedAt = o.placedAt;
        by.set(o.groupId, g);
      });
    return [...by.values()].sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt));
  }, [orders, tableNumber]);
  const needsBillChoice = openBills.length > 0 && !billChoice;
  const attachTo = openBills.find((b) => b.groupId === billChoice) || null;

  const missing = [];
  if (!tableNumber.trim()) missing.push(line === "accommodations" ? "room number" : "table");
  if (needsBillChoice) missing.push("which bill this is for");
  if (cart.length === 0) missing.push("at least one item");
  if (isStaffOrder && !isNonNegative(staffTotal)) missing.push("the reduced total");

  const submit = async () => {
    if (!tableNumber.trim()) { onError?.("Enter the table/room number before placing the order."); return; }
    if (needsBillChoice) { onError?.("Choose which bill this order is for, or start a new bill."); return; }
    if (cart.length === 0) { onError?.("Add at least one item to the cart before placing the order."); return; }
    if (isStaffOrder && (!staffTotal || Number(staffTotal) < 0)) { onError?.("Enter the reduced price for this staff order."); return; }
    setBusy(true);
    try {
      // Orders are never rejected for short stock — the DB-side trigger records the
      // shortage and notifies the manager, the relevant department, and the storekeeper
      // instead of blocking the insert. See notify_order_item_if_short (migration 0016).
      // The kitchen/barista/reception queues each route by a single order.line, so a cart
      // mixing categories (e.g. a burger + a cappuccino) becomes one order per line here —
      // all sharing the same table/client — rather than trying to make one order serve
      // multiple departments at once. groupId ties these sibling orders back together so
      // ReadyToServe (and this screen's own recent-orders list) can show them as one card
      // for the table instead of several, even though kitchen/barista/billing keep working
      // on the individual per-line orders exactly as before.
      const groups = {};
      cart.forEach((x) => { (groups[x.line] ||= []).push(x); });
      const lineKeys = Object.keys(groups);
      // Added to an existing bill: reuse its group id (and customer), so it stays on that bill.
      const groupId = attachTo ? attachTo.groupId : crypto.randomUUID();
      const billClient = attachTo ? attachTo.client : client.trim();
      const billPhone = attachTo ? attachTo.phone : phone.trim();
      // A staff order's reduced total is entered once for the whole cart, so when it spans
      // multiple lines each line gets its proportional share of that reduced total rather
      // than the full menu price.
      const reducedTotal = isStaffOrder ? Number(staffTotal) || 0 : null;
      for (const ln of lineKeys) {
        const lineMenuTotal = groups[ln].reduce((s, x) => s + x.price * x.qty, 0);
        const lineStaffTotal = reducedTotal == null ? null : Math.round(reducedTotal * (lineMenuTotal / total));
        await placeOrder({ client: billClient, tableNumber: tableNumber.trim(), phone: billPhone, line: ln, cart: groups[ln], session, groupId, isStaffOrder, staffTotal: lineStaffTotal });
      }
      setJustPlaced({
        client: client.trim(),
        tableNumber: tableNumber.trim(),
        line: lineKeys[0],
        total,
        count: itemCount,
        breakdown: lineKeys.map((ln) => ({
          line: ln,
          count: groups[ln].reduce((s, x) => s + x.qty, 0),
        })),
      });
      setClient(""); setTableNumber(""); setPhone(""); setCart([]); setSearch(""); setBillChoice(""); draftClear(draftKey);
      setIsStaffOrder(false); setStaffTotal("");
      setKiosk(false); // hand the tablet back to staff view once the client's order is in
      await refresh();
    } catch (e) {
      onError?.(e.message || "Couldn't place the order — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const enterKiosk = () => {
    if (!tableNumber.trim()) { onError?.("Set the table/room number first, then hand the tablet to the client."); return; }
    if (needsBillChoice) { onError?.("Choose which bill this order is for (or a new bill) before handing the tablet over."); return; }
    setKiosk(true);
  };

  const itemTile = (m, big) => {
    const qty = cartQty(m.id);
    return (
      <div key={m.id} className={`border-2 rounded-lg flex flex-col justify-between ${big ? "p-4 min-h-[128px]" : "p-3 min-h-[96px]"}`}
        style={{ borderColor: qty > 0 ? "var(--ember)" : "rgba(38,34,29,0.12)", background: qty > 0 ? "rgba(181,74,40,0.05)" : "white" }}>
        <div>
          <div className={big ? "text-base font-medium leading-tight" : "text-sm font-medium leading-tight"}>{m.name}</div>
          <div className={`text-[var(--basalt)]/50 font-mono mt-1 ${big ? "text-sm" : "text-xs"}`}>RWF {fmt(m.price)}</div>
        </div>
        {qty === 0 ? (
          <button onClick={() => addToCart(m)} className={`mt-2 w-full rounded font-semibold text-white ${big ? "py-3.5 text-base" : "py-2.5 text-sm"}`} style={{ background: "var(--ember)" }}>
            Add
          </button>
        ) : (
          <div className="mt-2 flex items-center justify-between">
            <button onClick={() => setQty(m.id, qty - 1)} aria-label={`Remove one ${m.name}`}
              className={`rounded-full flex items-center justify-center text-white ${big ? "w-12 h-12" : "w-10 h-10"}`} style={{ background: "var(--basalt)" }}>
              <Minus size={big ? 18 : 16} />
            </button>
            <span className={`font-mono font-semibold ${big ? "text-xl" : "text-lg"}`}>{qty}</span>
            <button onClick={() => addToCart(m)} aria-label={`Add one more ${m.name}`}
              className={`rounded-full flex items-center justify-center text-white ${big ? "w-12 h-12" : "w-10 h-10"}`} style={{ background: "var(--ember)" }}>
              <Plus size={big ? 18 : 16} />
            </button>
          </div>
        )}
      </div>
    );
  };

  const lineTabs = (compact) => (
    <div className="flex gap-2 mb-4">
      {Object.entries(LINES).map(([k, v]) => (
        <button key={k} onClick={() => { setLine(k); setSearch(""); }}
          className={`flex-1 rounded-md text-sm font-semibold border-2 transition-colors ${compact ? "py-2.5" : "py-3"}`}
          style={{
            borderColor: line === k ? v.color : "rgba(38,34,29,0.12)",
            background: line === k ? v.color + "1a" : "white",
            color: line === k ? v.color : "var(--basalt)",
          }}>
          {v.label}
        </button>
      ))}
    </div>
  );

  // Kiosk mode: a fullscreen overlay with just the menu, cart, and place-order button —
  // no nav, sign-out, recent orders, or operational flags — for when the tablet gets
  // physically handed to the client to order for themselves. Line tabs stay available so
  // the client can browse multiple categories without losing what's already in the cart.
  if (kiosk) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: "var(--stone)" }}>
        <div className="max-w-3xl mx-auto p-4 sm:p-6 pb-28">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-[var(--basalt)]/50">Table / Room</div>
              <div className="lr-display text-2xl font-medium">{tableNumber}</div>
            </div>
            <button onClick={() => setKiosk(false)} className="flex items-center gap-1 text-xs text-[var(--basalt)]/40 px-3 py-2 border border-[var(--basalt)]/15 rounded">
              <X size={13} /> Staff exit
            </button>
          </div>

          {lineTabs(true)}

          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--basalt)]/30" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu…"
              className="w-full border border-[var(--basalt)]/15 rounded px-10 py-3 text-base bg-white" />
          </div>

          {availableItems.length === 0 ? (
            <p className="text-sm text-[var(--basalt)]/50">No items match your search.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {availableItems.map((m) => itemTile(m, true))}
            </div>
          )}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[var(--basalt)]/10 p-4 flex items-center justify-between gap-4">
          <div className="text-sm">
            <span className="font-semibold">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
            <span className="text-[var(--basalt)]/50"> · RWF {fmt(total)}</span>
          </div>
          <PrimaryBtn disabled={busy || cart.length === 0} onClick={submit} className="text-base py-3 px-6">
            <Plus size={16} /> {busy ? "Placing…" : "Place order"}
          </PrimaryBtn>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {detailsOrder && <OrderDetailsModal order={detailsOrder} onClose={() => setDetailsOrder(null)} />}
      {justPlaced && (
        <div className="flex items-center gap-2 p-4 rounded-md text-sm font-medium" style={{ background: "rgba(70,88,63,0.12)", color: "var(--moss)" }}>
          <CheckCircle2 size={18} />
          <span>
            Order placed for {orderLabel(justPlaced)} — {justPlaced.breakdown.map((g) => `${g.count} item${g.count === 1 ? "" : "s"} (${LINES[g.line].label})`).join(", ")}, RWF {fmt(justPlaced.total)}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Client & line</SectionLabel>
            <button onClick={enterKiosk} className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded border-2" style={{ borderColor: "var(--moss)", color: "var(--moss)" }}>
              <Maximize2 size={13} /> Hand to client
            </button>
          </div>

          <div className="mb-4">
            <label className="text-xs text-[var(--basalt)]/60">{TABLE_LABEL[line]}<Req /></label>
            {line === "accommodations" ? (
              <Input value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} placeholder="e.g. 12" className="text-lg font-semibold" />
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {TABLE_SECTIONS.map((s) => (
                  <div key={s.section} className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--basalt)]/40 w-14 shrink-0">Sec. {s.section}</span>
                    {s.tables.map((t) => (
                      <button key={t} type="button" onClick={() => setTableNumber(t)}
                        className="px-3 py-1.5 rounded text-sm font-medium border-2"
                        style={{
                          borderColor: tableNumber === t ? "var(--ember)" : "rgba(38,34,29,0.15)",
                          background: tableNumber === t ? "rgba(181,74,40,0.08)" : "white",
                          color: tableNumber === t ? "var(--ember)" : "var(--basalt)",
                        }}>
                        {t}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {openBills.length > 0 && (
            <div className="mb-4 p-3 rounded-md border-2" style={{ borderColor: needsBillChoice ? "var(--ember)" : "rgba(38,34,29,0.12)" }}>
              <div className="text-xs font-semibold mb-2">Which bill is this for?<span style={{ color: "var(--ember)" }}> *</span></div>
              <div className="space-y-1.5">
                {openBills.map((b, i) => (
                  <button key={b.groupId} type="button" onClick={() => setBillChoice(b.groupId)}
                    className="w-full text-left px-3 py-2 rounded border-2 text-sm"
                    style={{ borderColor: billChoice === b.groupId ? "var(--ember)" : "rgba(38,34,29,0.15)", background: billChoice === b.groupId ? "rgba(181,74,40,0.08)" : "white" }}>
                    <span className="font-medium">{b.client || `Bill ${i + 1}`}</span>
                    <span className="text-xs text-[var(--basalt)]/60"> · {b.itemCount} item{b.itemCount === 1 ? "" : "s"} · RWF {fmt(b.total)} · started {new Date(b.placedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </button>
                ))}
                <button type="button" onClick={() => setBillChoice("new")}
                  className="w-full text-left px-3 py-2 rounded border-2 text-sm font-medium"
                  style={{ borderColor: billChoice === "new" ? "var(--ember)" : "rgba(38,34,29,0.15)", background: billChoice === "new" ? "rgba(181,74,40,0.08)" : "white" }}>
                  + New bill — another customer
                </button>
              </div>
            </div>
          )}

          {!attachTo && (<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <div>
              <label className="text-xs text-[var(--basalt)]/60">Client name (optional)</label>
              <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Jean Baptiste" />
            </div>
            <div>
              <label className="text-xs text-[var(--basalt)]/60">Phone (optional)</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>)}

          {lineTabs(false)}

          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--basalt)]/30" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search menu…"
              className="w-full border border-[var(--basalt)]/15 rounded px-9 py-2.5 text-sm bg-white" />
          </div>

          {availableItems.length === 0 ? (
            <p className="text-sm text-[var(--basalt)]/50">
              {menu.filter((m) => m.line === line).length === 0
                ? "No menu items for this line yet — add some in Menu & Recipes."
                : "No items match your search."}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {availableItems.map((m) => itemTile(m, false))}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <SectionLabel>Order summary</SectionLabel>
            {cart.length === 0 ? <p className="text-sm text-[var(--basalt)]/50">Cart is empty. Tap items to add them — you can mix items from different lines in the same ticket.</p> : (
              <div className="space-y-3">
                {cart.map((x) => (
                  <div key={x.menuId} className="flex items-center justify-between text-sm gap-2">
                    <span className="flex-1 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LINES[x.line].color }} title={LINES[x.line].label} />
                      {x.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setQty(x.menuId, x.qty - 1)} aria-label={`Decrease ${x.name} quantity`}
                        className="w-8 h-8 rounded-full flex items-center justify-center border border-[var(--basalt)]/20">
                        <Minus size={13} />
                      </button>
                      <span className="font-mono text-sm w-5 text-center">{x.qty}</span>
                      <button onClick={() => setQty(x.menuId, x.qty + 1)} aria-label={`Increase ${x.name} quantity`}
                        className="w-8 h-8 rounded-full flex items-center justify-center border border-[var(--basalt)]/20">
                        <Plus size={13} />
                      </button>
                    </div>
                    <span className="font-mono text-xs w-20 text-right">RWF {fmt(x.price * x.qty)}</span>
                    <button onClick={() => removeFromCart(x.menuId)} aria-label={`Remove ${x.name}`}><Trash2 size={14} className="text-[var(--basalt)]/30" /></button>
                  </div>
                ))}
                <div className="border-t border-[var(--basalt)]/10 pt-2 flex justify-between font-semibold"><span>Total</span><span className="font-mono">RWF {fmt(total)}</span></div>
                <label className="flex items-center gap-2 text-xs text-[var(--basalt)]/70 pt-1">
                  <input type="checkbox" checked={isStaffOrder}
                    onChange={(e) => { setIsStaffOrder(e.target.checked); if (e.target.checked && !staffTotal) setStaffTotal(String(total)); }} />
                  Staff personal order (reduced price)
                </label>
                {isStaffOrder && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--basalt)]/60 shrink-0">Reduced total (RWF)<Req /></span>
                    <Input type="number" value={staffTotal} onChange={(e) => setStaffTotal(e.target.value)} className="mt-0" />
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <PrimaryBtn disabled={busy || missing.length > 0} onClick={submit}><Plus size={15} /> Place order</PrimaryBtn>
            </div>
            <MissingHint items={missing} className="mt-2 text-right" />
          </Card>

          <Card>
            <SectionLabel>Your recent orders</SectionLabel>
            {myOrderGroups.length === 0 ? (
              <p className="text-sm text-[var(--basalt)]/50">Orders you place will show up here with their status.</p>
            ) : (
              <div className="space-y-3">
                {myOrderGroups.map((g) => (
                  <div key={g.key} className="text-sm border-b border-[var(--basalt)]/5 pb-2 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{orderLabel(g.orders[0])}</span>
                      <span className="text-xs text-[var(--basalt)]/40 shrink-0">{new Date(g.placedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="space-y-1 mt-1">
                      {g.orders.map((o) => (
                        <button key={o.id} onClick={() => setDetailsOrder(o)} className="w-full flex items-center justify-between gap-2 text-xs hover:underline text-left">
                          <span className="flex items-center gap-1.5 text-[var(--basalt)]/60 truncate">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: LINES[o.line].color }} />
                            {o.items.map((it) => `${it.qty}× ${it.name}`).join(", ")}
                            <Info size={10} className="text-[var(--basalt)]/30 shrink-0" />
                          </span>
                          <StatusBadge status={o.status} />
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-[var(--basalt)]/40 mt-1">RWF {fmt(g.total)}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <FlagsPanel flags={flags} />
        </div>
      </div>
    </div>
  );
}
