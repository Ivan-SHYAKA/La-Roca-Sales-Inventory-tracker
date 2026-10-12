import { useMemo, useState } from "react";
import { ShoppingBag, Package, BookOpen, UserCog, Wallet, ChevronDown, CheckCheck } from "lucide-react";
import { Card, SectionLabel, Input, Select, PrimaryBtn } from "./ui";
import { LINES, ROLES } from "../lib/constants";
import { fmt } from "../lib/format";

const CATEGORIES = {
  order: { label: "Orders", color: "#B54A28", icon: ShoppingBag },
  stock: { label: "Stock", color: "#46583F", icon: Package },
  menu: { label: "Menu & prices", color: "#B8923F", icon: BookOpen },
  account: { label: "Accounts", color: "#26221D", icon: UserCog },
  money: { label: "Money", color: "#8A6FB0", icon: Wallet },
};
const PAYMENT = { cash: "cash", mobile_money: "MoMo", card: "card", split: "cash + MoMo" };
const STOCK_REASON = { restock: "In", usage: "Out", waste: "Waste", spoilage: "Spoiled", missing: "Missing", other: "Other", adjustment: "Stock count correction" };
const FIELD_VALUE = (field, v) => {
  if (v === true) return "yes";
  if (v === false) return "no";
  if (v === null || v === undefined || v === "") return "—";
  if (/price|cost|amount/i.test(field) && !isNaN(Number(v))) return `RWF ${fmt(Number(v))}`;
  if (field === "Line" || field === "Used by") return LINES[v]?.label || v;
  if (field === "Role") return ROLES[v] || v;
  return String(v);
};

// One line of detail per thing that changed, written the way you'd say it out loud.
function detailLines(a) {
  const d = a.details || {};
  const out = [];
  const changes = (list) => (list || []).map((c) => `${c.field}: ${FIELD_VALUE(c.field, c.from)} → ${FIELD_VALUE(c.field, c.to)}`);
  switch (a.action) {
    case "stock_recorded":
      (d.items || []).forEach((i) => {
        const reversal = i.reason !== "adjustment" && ((i.type === "in" && i.reason !== "restock") || (i.type === "out" && i.reason === "restock"));
        const sign = i.type === "in" ? "+" : "−";
        const what = reversal ? `Correction (${STOCK_REASON[i.reason] || i.reason} lowered)` : STOCK_REASON[i.reason] || i.reason;
        out.push(`${what}: ${sign}${i.quantity} ${i.unit} ${i.name}${i.note ? ` — "${i.note}"` : ""}`);
      });
      break;
    case "dish_added":
      (d.items || []).forEach((i) => out.push(`${i.name} · ${LINES[i.line]?.label || i.line} · RWF ${fmt(i.price)}`));
      break;
    case "dish_edited":
      out.push(...changes(d.changes));
      break;
    case "recipe_set":
      (d.items || []).forEach((i) => out.push(`${i.quantity} ${i.unit} ${i.name}`));
      if ((d.items || []).length === 0) out.push("Recipe cleared");
      break;
    case "item_added":
      (d.items || []).forEach((i) => out.push(`${i.name} (${i.unit}${i.category ? `, ${i.category}` : ""})`));
      break;
    case "item_edited":
      (d.items || []).forEach((i) => out.push(`${i.name} — ${changes(i.changes).join("; ")}`));
      break;
    case "cost_added":
    case "cost_edited":
    case "cost_removed":
      out.push(`${d.name}: RWF ${fmt(d.amount)} ${d.frequency === "monthly" ? "every month" : "one time"}`);
      break;
    case "loan_added":
    case "loan_removed":
      out.push(`${d.name}: RWF ${fmt(d.amount)}${d.date ? ` · ${d.date}` : ""}${d.note ? ` — ${d.note}` : ""}`);
      break;
    case "loan_repayment":
      out.push(`${d.name} repaid RWF ${fmt(d.amount)} of RWF ${fmt(d.borrowed)}; RWF ${fmt(d.remaining)} still owed${d.note ? ` — ${d.note}` : ""}`);
      break;
    case "cash_book_saved": {
      const money = (v) => (v == null ? "—" : `RWF ${fmt(v)}`);
      out.push(`Opening: cash ${money(d.opening_cash)}, MoMo ${money(d.opening_momo)}`);
      out.push(`Closing counted: cash ${money(d.closing_cash)}, MoMo ${money(d.closing_momo)}`);
      if (d.note) out.push(`Note: ${d.note}`);
      break;
    }
    case "account_updated":
    case "password_reset":
      out.push(...changes(d.changes));
      break;
    case "account_created":
    case "signup_approved":
    case "signup_requested":
    case "signup_rejected":
    case "account_enabled":
    case "account_disabled":
      out.push([d.name, d.username ? `(${d.username})` : "", d.role ? `· ${ROLES[d.role] || d.role}` : ""].filter(Boolean).join(" "));
      break;
    default:
      if (a.category === "order") {
        if ((d.lines || []).length) out.push(d.lines.map((l) => LINES[l]?.label || l).join(" + "));
        if (d.client && d.client !== d.table) out.push(`Client: ${d.client}`);
        if (d.staff_order) out.push("Staff personal order (reduced price)");
        if (Array.isArray(d.payments) && d.payments.length) out.push(`Paid ${d.payments.map((p) => `${PAYMENT[p.method] || p.method} RWF ${fmt(p.amount)}`).join(" + ")}`);
        else if (d.payment_method) out.push(`Paid ${d.amount_paid != null ? `RWF ${fmt(d.amount_paid)} ` : ""}by ${PAYMENT[d.payment_method] || d.payment_method}`);
        if (d.cancel_reason) out.push(`Reason: ${d.cancel_reason}`);
        if (d.void_reason) out.push(`Reason: ${d.void_reason}`);
        if (a.action === "invoice_removal_requested" || a.action === "invoice_removal_rejected") {
          if (d.total) out.push(`Invoice total: RWF ${fmt(d.total)}`);
          if (d.reason) out.push(`Reason given: ${d.reason}`);
          if (d.asked_by) out.push(`Asked by ${d.asked_by}`);
          if (d.note) out.push(`Manager's answer: ${d.note}`);
        }
      }
  }
  return out;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

// What the staff have been doing, newest first. New items (from other people) are marked
// until the manager presses "Mark all as read" — the count also shows on the tab.
export function StaffActivity({ entries, seenAt, myId, canLoadMore, onLoadMore, onMarkRead }) {
  const [category, setCategory] = useState("all");
  const [person, setPerson] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState(false);

  const seen = seenAt ? new Date(seenAt).getTime() : 0;
  const isUnread = (a) => a.actorId !== myId && new Date(a.at).getTime() > seen;
  const unread = useMemo(() => entries.filter(isUnread).length, [entries, seen, myId]);
  const people = useMemo(() => [...new Set(entries.map((a) => a.actorName))].sort(), [entries]);
  const counts = useMemo(() => {
    const c = {};
    entries.forEach((a) => { c[a.category] = (c[a.category] || 0) + 1; });
    return c;
  }, [entries]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((a) =>
      (category === "all" || a.category === category) &&
      (person === "all" || a.actorName === person) &&
      (!unreadOnly || isUnread(a)) &&
      (!q || a.summary.toLowerCase().includes(q) || a.actorName.toLowerCase().includes(q) || detailLines(a).some((l) => l.toLowerCase().includes(q)))
    );
  }, [entries, category, person, unreadOnly, search, seen, myId]);

  const groups = useMemo(() => {
    const g = [];
    shown.forEach((a) => {
      const label = dayLabel(a.at);
      if (!g.length || g[g.length - 1].label !== label) g.push({ label, items: [] });
      g[g.length - 1].items.push(a);
    });
    return g;
  }, [shown]);

  const markRead = async () => {
    setBusy(true);
    try { await onMarkRead(); } finally { setBusy(false); }
  };

  const chip = (key, label, count, color) => (
    <button key={key} onClick={() => setCategory(key)} className="text-xs px-3 py-1.5 rounded-full font-medium border"
      style={category === key
        ? { background: color, color: "white", borderColor: color }
        : { background: color + "11", color, borderColor: color + "44" }}>
      {label} ({count})
    </button>
  );

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel>Staff activity</SectionLabel>
            <p className="text-xs text-[var(--basalt)]/50 -mt-1">
              Everything staff do in the system, with who did it and when.
              {" "}{unread > 0 ? <b style={{ color: "var(--ember)" }}>{unread} new since you last marked it as read.</b> : "You're all caught up."}
            </p>
          </div>
          <PrimaryBtn color="var(--moss)" disabled={busy || unread === 0} onClick={markRead}><CheckCheck size={15} /> Mark all as read</PrimaryBtn>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {chip("all", "Everything", entries.length, "#26221D")}
          {Object.entries(CATEGORIES).map(([k, c]) => chip(k, c.label, counts[k] || 0, c.color))}
        </div>
        <div className="flex flex-wrap gap-3 items-end mt-3">
          <div className="min-w-[160px]">
            <label className="text-xs text-[var(--basalt)]/60">Person</label>
            <Select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="all">Everyone</option>
              {people.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="text-xs text-[var(--basalt)]/60">Search</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Person, item, dish, table…" />
          </div>
          <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Only new</label>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card><p className="text-sm text-[var(--basalt)]/50">{entries.length === 0 ? "Nothing has happened yet. Staff activity will appear here as it happens." : "Nothing matches those filters."}</p></Card>
      ) : groups.map((g) => (
        <Card key={g.label} className="!p-0 overflow-hidden">
          <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide bg-[var(--basalt)]/[0.04] border-b border-[var(--basalt)]/10">{g.label}</div>
          <ul>
            {g.items.map((a) => {
              const cat = CATEGORIES[a.category] || CATEGORIES.menu;
              const Icon = cat.icon;
              const lines = detailLines(a);
              const fresh = isUnread(a);
              const expanded = !!open[a.id];
              const total = a.category === "order" && a.details?.total ? `RWF ${fmt(a.details.total)}` : "";
              return (
                <li key={a.id} className="border-b border-[var(--basalt)]/5 last:border-0" style={{ background: fresh ? "rgba(181,74,40,0.05)" : "transparent" }}>
                  <button className="w-full text-left px-4 py-3 flex items-start gap-3" onClick={() => lines.length && setOpen((o) => ({ ...o, [a.id]: !o[a.id] }))}
                    style={{ cursor: lines.length ? "pointer" : "default" }}>
                    <span className="mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: cat.color + "1a", color: cat.color }}>
                      <Icon size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm">
                        {/* Sign-up rows already start with the person's own name. */}
                        {a.summary.startsWith(a.actorName) ? (
                          <b>{a.summary}</b>
                        ) : (
                          <>
                            <b>{a.actorId === myId ? "You" : a.actorName}</b>
                            {a.actorRole && a.actorId !== myId && <span className="text-xs text-[var(--basalt)]/50"> · {ROLES[a.actorRole] || a.actorRole}</span>}
                            <span className="text-[var(--basalt)]/80"> {a.summary.charAt(0).toLowerCase() + a.summary.slice(1)}</span>
                          </>
                        )}
                      </span>
                      {!expanded && lines.length > 0 && <span className="block text-xs text-[var(--basalt)]/50 truncate mt-0.5">{lines[0]}{lines.length > 1 ? `  · +${lines.length - 1} more` : ""}</span>}
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-xs text-[var(--basalt)]/50">{new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      {total && <span className="block text-xs font-mono">{total}</span>}
                      {fresh && <span className="inline-block mt-1 w-2 h-2 rounded-full" style={{ background: "var(--ember)" }} title="New" />}
                    </span>
                    {lines.length > 0 && <ChevronDown size={16} className="mt-1 shrink-0 text-[var(--basalt)]/40 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "none" }} />}
                  </button>
                  {expanded && (
                    <ul className="px-4 pb-3 pl-[3.75rem] space-y-0.5">
                      {lines.map((l, i) => <li key={i} className="text-xs text-[var(--basalt)]/70">{l}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      {canLoadMore && (
        <div className="flex justify-center">
          <button onClick={onLoadMore} className="px-4 py-2 rounded text-sm border border-[var(--basalt)]/20">Show older activity</button>
        </div>
      )}
    </div>
  );
}
