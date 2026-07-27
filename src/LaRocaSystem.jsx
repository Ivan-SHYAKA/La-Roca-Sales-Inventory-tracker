import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2, LogOut } from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import { fetchProfile, fetchProfiles, fetchOrders, fetchStorekeeperOrders, fetchMenu, fetchInventory, fetchStockEvents, fetchStockAlerts, subscribeToChanges } from "./lib/data";
import { computeFlags } from "./lib/business";
import { ROLES, LINES } from "./lib/constants";
import { orderLabel } from "./lib/format";
import { playChime } from "./lib/sound";
import { SetupAdmin, LoginForm, UsersManager } from "./components/Auth";
import { Dashboard } from "./components/Dashboard";
import { MenuManager } from "./components/MenuManager";
import { NewOrder } from "./components/NewOrder";
import { BillingBoard } from "./components/billing";
import { DeptQueue } from "./components/DeptQueue";
import { ReadyToServe } from "./components/ReadyToServe";
import { CheckInQueue } from "./components/CheckInQueue";
import { StockForm } from "./components/StockForm";
import { InventoryView } from "./components/InventoryView";
import { DailyStockReport } from "./components/DailyStockReport";
import { StockAlertsBanner } from "./components/StockAlertsBanner";
import { ActivityLog } from "./components/ActivityLog";
import { ToastStack } from "./components/Toasts";
import logo from "./assets/la-roca-logo.svg";

const WRAPPER_STYLE = {
  "--stone": "#EDEAE2", "--basalt": "#26221D", "--ember": "#B54A28", "--moss": "#46583F", "--gold": "#B8923F", "--cream": "#F7F4EE",
  fontFamily: "'Inter', sans-serif", background: "var(--stone)", color: "var(--basalt)", minHeight: "100%", padding: "24px",
};
const FontStyle = () => (
  <style>{`
    .lr-display { font-family: 'Fraunces', serif; }
    button { cursor: pointer; }
    @media print { body * { visibility: hidden; } .invoice-print, .invoice-print * { visibility: visible; } .invoice-print { position: fixed; top: 0; left: 0; width: 100%; } .no-print { display: none !important; } }
  `}</style>
);

export default function LaRocaSystem() {
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState(null);
  const [noAccountsYet, setNoAccountsYet] = useState(false);
  const [tab, setTab] = useState(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  const [orders, setOrders] = useState([]);
  const [storeOrders, setStoreOrders] = useState([]);
  const [stockAlerts, setStockAlerts] = useState([]);
  const [menu, setMenu] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [stockEvents, setStockEvents] = useState([]);
  const [users, setUsers] = useState([]);
  const [toasts, setToasts] = useState([]);
  const seenOrderIds = useRef(null); // null = "haven't taken a baseline snapshot yet" -> don't alert

  useEffect(() => {
    const iv = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [o, so, m, inv, se, sa, u] = await Promise.all([
        fetchOrders(), fetchStorekeeperOrders(), fetchMenu(), fetchInventory(), fetchStockEvents(), fetchStockAlerts(), fetchProfiles(),
      ]);
      setOrders(o); setStoreOrders(so); setMenu(m); setInventory(inv); setStockEvents(se); setStockAlerts(sa); setUsers(u);
      setError("");
    } catch (e) {
      setError(e.message || "Couldn't load data — check your connection and try again.");
    }
  }, []);

  // Auth bootstrap: resume an existing Supabase session, or figure out whether
  // this is a brand-new install (no accounts yet -> show the setup screen).
  // Re-checked (not just computed once at mount) whenever we land back on the
  // signed-out screens, whatever the reason — sign-out, or a stale/orphaned
  // session for a since-deleted user — so it never gets stuck showing the wrong
  // one of "Set up La Roca" vs. the normal login form.
  useEffect(() => {
    let mounted = true;
    const refreshNoAccountsYet = async () => {
      const { data } = await supabase.rpc("profiles_count");
      if (mounted) setNoAccountsYet(Number(data) === 0);
    };

    (async () => {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      if (authSession) {
        try {
          const profile = await fetchProfile(authSession.user.id);
          if (mounted) setSession(profile);
        } catch (e) {
          await supabase.auth.signOut();
          if (mounted) setSession(null);
          await refreshNoAccountsYet();
        }
      } else {
        await refreshNoAccountsYet();
      }
      if (mounted) setBooting(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, authSession) => {
      if (!authSession) {
        setSession(null);
        setTab(null);
        await refreshNoAccountsYet();
        return;
      }
      try {
        const profile = await fetchProfile(authSession.user.id);
        setSession(profile);
      } catch (e) { /* profile not ready yet (e.g. mid sign-up) — ignore transient error */ }
    });
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, []);

  // Once signed in: load everything this role can see, and keep it fresh via realtime.
  useEffect(() => {
    if (!session) return;
    loadData();
    return subscribeToChanges(
      ["orders", "order_items", "menu_items", "recipe_ingredients", "inventory", "stock_events", "stock_alerts", "profiles"],
      loadData
    );
  }, [session?.id, loadData]);

  useEffect(() => {
    if (session && !tab) {
      const defaults = { manager: "dashboard", waiter: "neworder", sales: "billing", kitchen: "kitchenqueue", barista: "baristaqueue", storekeeper: "dailyreport" };
      setTab(defaults[session.role] || "dashboard");
    }
  }, [session]);

  // A new order arriving is easy to miss if kitchen/barista/sales are only watching a
  // queue count change — this alerts them directly. Skips the very first snapshot after
  // sign-in (or role switch) so existing orders don't all "ping" at once.
  useEffect(() => { seenOrderIds.current = null; }, [session?.id]);
  useEffect(() => {
    if (!session) return;
    const prevIds = seenOrderIds.current;
    if (prevIds) {
      orders
        .filter((o) => o.status === "placed" && !prevIds.has(o.id))
        .filter((o) =>
          (session.role === "kitchen" && o.line === "restaurant") ||
          (session.role === "barista" && o.line === "coffeeshop") ||
          session.role === "sales"
        )
        .forEach((o) => {
          const id = `${o.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          setToasts((t) => [...t, { id, message: `New order — ${orderLabel(o)} (${LINES[o.line].label})` }]);
          setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
          playChime();
        });
    }
    seenOrderIds.current = new Set(orders.map((o) => o.id));
  }, [orders, session]);

  const flags = useMemo(() => computeFlags(orders), [orders, tick]);

  if (booting) return <div className="flex items-center justify-center h-64 gap-2 text-[var(--basalt)]/60"><Loader2 className="animate-spin" size={18} /> Loading La Roca…</div>;

  if (!session) {
    return (
      <div style={WRAPPER_STYLE}>
        <FontStyle />
        {noAccountsYet ? <SetupAdmin /> : <LoginForm />}
      </div>
    );
  }

  const tabsForRole = {
    manager: [["dashboard", "Dashboard"], ["billing", "Orders"], ["checkin", "Check-in"], ["menu", "Menu & Recipes"], ["inventory", "Inventory"], ["dailyreport", "Daily Stock Report"], ["users", "Users"], ["activity", "My Activity"]],
    waiter: [["neworder", "Take Order"], ["readytoserve", "Ready to Serve"], ["activity", "My Activity"]],
    sales: [["neworder", "New Order / Booking"], ["readytoserve", "Ready to Serve"], ["checkin", "Check-in"], ["billing", "Orders & Billing"], ["activity", "My Activity"]],
    kitchen: [["kitchenqueue", "Kitchen Queue"], ["activity", "My Activity"]],
    barista: [["baristaqueue", "Barista Queue"], ["activity", "My Activity"]],
    storekeeper: [["dailyreport", "Daily Stock Report"], ["stockin", "Stock In"], ["stockout", "Stock Out"], ["inventory", "Inventory"], ["activity", "My Activity"]],
  }[session.role];

  return (
    <div style={WRAPPER_STYLE}>
      <FontStyle />
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6 pb-5 no-print" style={{ borderBottom: "2px solid var(--basalt)" }}>
        <div className="flex items-center gap-3">
          <img src={logo} alt="La Roca" className="w-16 h-16" />
          <div>
            <h1 className="lr-display text-3xl font-medium tracking-tight">La Roca</h1>
            <p className="text-sm text-[var(--basalt)]/60 mt-1">{session.name} · {ROLES[session.role]}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex gap-1 bg-[var(--cream)] p-1 rounded-md border border-[var(--basalt)]/10">
            {tabsForRole.map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)} className="px-4 py-2 rounded text-sm font-medium"
                style={{ background: tab === key ? "var(--basalt)" : "transparent", color: tab === key ? "var(--cream)" : "var(--basalt)" }}>
                {label}
              </button>
            ))}
          </nav>
          <button onClick={() => supabase.auth.signOut()} className="flex items-center gap-1 text-sm text-[var(--basalt)]/60"><LogOut size={15} /> Sign out</button>
        </div>
      </div>

      {error && <div className="mb-4 text-sm text-[var(--ember)] no-print">{error}</div>}

      {["kitchen", "storekeeper", "manager"].includes(session.role) && (
        <StockAlertsBanner
          alerts={stockAlerts}
          canResolve={session.role === "storekeeper" || session.role === "manager"}
          refresh={loadData}
          onError={setError}
        />
      )}

      {tab === "dashboard" && <Dashboard orders={orders} inventory={inventory} stockEvents={stockEvents} menu={menu} flags={flags} />}
      {tab === "menu" && <MenuManager menu={menu} inventory={inventory} session={session} refresh={loadData} onError={setError} />}
      {tab === "users" && <UsersManager users={users} session={session} refreshUsers={loadData} onError={setError} />}
      {tab === "billing" && <BillingBoard orders={orders} session={session} refresh={loadData} onError={setError} />}
      {tab === "neworder" && <NewOrder menu={menu} orders={orders} session={session} refresh={loadData} onError={setError} flags={flags} />}
      {tab === "readytoserve" && <ReadyToServe orders={orders} session={session} refresh={loadData} onError={setError} flags={flags} />}
      {tab === "kitchenqueue" && <DeptQueue dept="kitchen" line="restaurant" orders={orders} session={session} refresh={loadData} onError={setError} flags={flags} />}
      {tab === "baristaqueue" && <DeptQueue dept="barista" line="coffeeshop" orders={orders} session={session} refresh={loadData} onError={setError} flags={flags} />}
      {tab === "checkin" && <CheckInQueue orders={orders} menu={menu} inventory={inventory} session={session} refresh={loadData} onError={setError} />}
      {tab === "stockin" && <StockForm mode="in" inventory={inventory} stockEvents={stockEvents} session={session} refresh={loadData} onError={setError} />}
      {tab === "stockout" && <StockForm mode="out" inventory={inventory} stockEvents={stockEvents} orders={storeOrders} session={session} refresh={loadData} onError={setError} />}
      {tab === "inventory" && <InventoryView inventory={inventory} orders={session.role === "storekeeper" ? storeOrders : orders} menu={menu} stockEvents={stockEvents} />}
      {tab === "dailyreport" && <DailyStockReport inventory={inventory} orders={session.role === "storekeeper" ? storeOrders : orders} menu={menu} stockEvents={stockEvents} session={session} />}
      {tab === "activity" && <ActivityLog orders={orders} stockEvents={stockEvents} inventory={inventory} session={session} />}
    </div>
  );
}
