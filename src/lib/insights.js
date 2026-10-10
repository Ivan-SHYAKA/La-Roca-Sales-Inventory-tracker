// Business insights: learns from the orders and stock records the system already keeps.
//
// These are small, honest statistical models (regression, correlation, seasonal averages) --
// the right size for one restaurant's data. They start out cautious and say so when there
// isn't enough history yet, then sharpen on their own as more orders and stock records
// come in. Everything is computed from data already loaded in the browser, so it updates
// live with the rest of the app and needs no separate service.
import { orderPrepMinutes, groupOrdersByGroupId, profitLossForPeriod } from "./business";

const DAY_MS = 86400000;
const DONE = ["served", "billed"];
const pad = (n) => String(n).padStart(2, "0");

export const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
function describe(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return { n: s.length, mean: mean(s), median: percentile(s, 0.5), p90: percentile(s, 0.9), min: s[0], max: s[s.length - 1] };
}
// How closely two lists move together: 1 = in step, 0 = unrelated. Null when it can't be told.
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Minimum history before each kind of answer is worth showing.
export const NEEDS = { ingredientDays: 7, serviceOrders: 20, demandOrders: 30, demandDays: 7, runwayDays: 3 };

// How much the system has seen so far, so every screen can say "still learning" honestly.
export function dataReadiness({ orders, stockEvents }) {
  const served = orders.filter((o) => DONE.includes(o.status) && o.servedAt);
  const orderDays = new Set(served.map((o) => dayKey(o.servedAt)));
  const usageDays = new Set(
    stockEvents.filter((e) => e.type === "out" && e.reason === "usage" && e.source !== "auto_deduction").map((e) => dayKey(e.date))
  );
  const both = [...orderDays].filter((d) => usageDays.has(d));
  return { servedOrders: served.length, orderDays: orderDays.size, usageDays: usageDays.size, overlapDays: both.length };
}

// ---------------------------------------------------------------------------------------
// 1. Ingredients per order: how closely recorded stock-out follows orders, and how much of
//    each ingredient a dish really uses (learned) compared with its written recipe.
// ---------------------------------------------------------------------------------------
export function learnIngredientUsage({ orders, menu, inventory, stockEvents }) {
  const menuMap = Object.fromEntries(menu.map((m) => [m.id, m]));
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));

  const dishByDay = new Map();
  orders.forEach((o) => {
    if (!DONE.includes(o.status) || !o.servedAt) return;
    const k = dayKey(o.servedAt);
    const m = dishByDay.get(k) || new Map();
    o.items.forEach((it) => { if (it.menuId) m.set(it.menuId, (m.get(it.menuId) || 0) + it.qty); });
    dishByDay.set(k, m);
  });

  const usageByInv = new Map();
  const daysWithUsage = new Set();
  stockEvents.forEach((e) => {
    if (e.type !== "out" || e.reason !== "usage" || e.source === "auto_deduction") return;
    const k = dayKey(e.date);
    daysWithUsage.add(k);
    const m = usageByInv.get(e.invId) || new Map();
    m.set(k, (m.get(k) || 0) + e.quantity);
    usageByInv.set(e.invId, m);
  });

  // A day only teaches us something when the storekeeper recorded usage that day. A busy
  // day with nothing recorded is a gap in the records, not an ingredient that wasn't used.
  const learnDays = [...dishByDay.keys()].filter((d) => daysWithUsage.has(d)).sort();
  const result = { nDays: learnDays.length, ingredients: [], byDish: {}, learnDays };
  if (learnDays.length === 0) return result;

  const dishSet = new Set();
  learnDays.forEach((d) => dishByDay.get(d).forEach((_, k) => dishSet.add(k)));
  const dishes = [...dishSet];
  const X = learnDays.map((d) => dishes.map((k) => dishByDay.get(d).get(k) || 0));
  const dishOrdered = dishes.map((_, j) => sum(X.map((r) => r[j])));
  const dishDays = dishes.map((_, j) => X.filter((r) => r[j] > 0).length);
  // The prior counts for about three days of data; after that the records outweigh it.
  const lambda = Math.max(1e-9, 3 * mean(dishes.map((_, j) => sum(X.map((r) => r[j] ** 2)) / learnDays.length)));

  const invIds = new Set(usageByInv.keys());
  dishes.forEach((k) => (menuMap[k]?.recipe || []).forEach((r) => invIds.add(r.invId)));

  invIds.forEach((invId) => {
    const inv = invMap[invId];
    if (!inv) return;
    const y = learnDays.map((d) => usageByInv.get(invId)?.get(d) || 0);
    const prior = dishes.map((k) => (menuMap[k]?.recipe || []).filter((r) => r.invId === invId).reduce((s, r) => s + r.qty, 0));
    if (sum(y) === 0 && sum(prior) === 0) return;

    // Non-negative ridge regression toward the recipe, by coordinate descent.
    // Only dishes whose recipe lists this ingredient are fitted. Letting every dish compete
    // for it makes busy days (more of everything) smear one dish's real use across the
    // others. If no recipe mentions the ingredient at all, every dish is fitted instead, so
    // the model can still show which dishes seem to drive its use.
    const hasRecipe = prior.some((p) => p > 0);
    const fitted = dishes.map((_, j) => !hasRecipe || prior[j] > 0);
    const beta = [...prior];
    for (let iter = 0; iter < 60; iter++) {
      for (let j = 0; j < dishes.length; j++) {
        if (!fitted[j]) continue;
        let num = lambda * prior[j];
        let den = lambda;
        for (let d = 0; d < learnDays.length; d++) {
          const xj = X[d][j];
          if (!xj) continue;
          let rest = y[d];
          for (let q = 0; q < dishes.length; q++) if (q !== j) rest -= X[d][q] * beta[q];
          num += xj * rest;
          den += xj * xj;
        }
        beta[j] = Math.max(0, num / den);
      }
    }
    const expectedDaily = X.map((r) => sum(r.map((c, j) => c * prior[j])));
    const row = {
      invId,
      name: inv.name,
      unit: inv.unit,
      recordedTotal: sum(y),
      expectedTotal: sum(expectedDaily),
      correlation: pearson(expectedDaily, y),
      perDish: [],
    };
    row.ratio = row.expectedTotal > 0 ? row.recordedTotal / row.expectedTotal : null;
    dishes.forEach((k, j) => {
      if (prior[j] === 0 && beta[j] < 1e-6) return;
      const confidence = dishOrdered[j] >= 10 && dishDays[j] >= 5 ? "good" : "low";
      const entry = {
        menuId: k,
        dish: menuMap[k]?.name || "Unknown dish",
        recipeQty: prior[j],
        learnedQty: beta[j],
        changePct: prior[j] > 0 ? (beta[j] - prior[j]) / prior[j] : null,
        ordered: dishOrdered[j],
        daysOrdered: dishDays[j],
        confidence,
      };
      row.perDish.push(entry);
      (result.byDish[k] ||= []).push({ ...entry, invId, ingredient: inv.name, unit: inv.unit });
    });
    result.ingredients.push(row);
  });
  result.ingredients.sort((a, b) => (b.recordedTotal + b.expectedTotal) - (a.recordedTotal + a.expectedTotal));
  return result;
}

// One row per day (dishes ordered, ingredients used) -- the table behind the model, so the
// same data can be taken into a spreadsheet or Python for deeper work.
export function trainingTable({ orders, menu, inventory, stockEvents }) {
  const dishNames = Object.fromEntries(menu.map((m) => [m.id, m.name]));
  const invNames = Object.fromEntries(inventory.map((i) => [i.id, `${i.name} (${i.unit})`]));
  const days = new Map();
  const row = (k) => days.get(k) || days.set(k, { date: k, dishes: {}, usage: {} }).get(k);
  orders.forEach((o) => {
    if (!DONE.includes(o.status) || !o.servedAt) return;
    const r = row(dayKey(o.servedAt));
    o.items.forEach((it) => { const n = dishNames[it.menuId] || it.name; r.dishes[n] = (r.dishes[n] || 0) + it.qty; });
  });
  stockEvents.forEach((e) => {
    if (e.type !== "out" || e.reason !== "usage" || e.source === "auto_deduction") return;
    const r = row(dayKey(e.date));
    const n = invNames[e.invId] || e.invId;
    r.usage[n] = (r.usage[n] || 0) + e.quantity;
  });
  const dishCols = [...new Set([...days.values()].flatMap((r) => Object.keys(r.dishes)))].sort();
  const usageCols = [...new Set([...days.values()].flatMap((r) => Object.keys(r.usage)))].sort();
  const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { dishCols, usageCols, rows };
}

// ---------------------------------------------------------------------------------------
// 2. Time to process an order: placed -> ready (kitchen/barista) -> served (waiter).
// ---------------------------------------------------------------------------------------
function solve(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// Least squares with a tiny ridge; features that come out negative are dropped and refit,
// so the plain-language sentence never says "more orders ahead makes it faster".
function fitLinear(rows, y, names) {
  let active = names.map((_, i) => i);
  for (let attempt = 0; attempt < names.length; attempt++) {
    const k = active.length + 1;
    const A = Array.from({ length: k }, () => Array(k).fill(0));
    const b = Array(k).fill(0);
    rows.forEach((r, i) => {
      const v = [1, ...active.map((a) => r[a])];
      for (let p = 0; p < k; p++) { b[p] += v[p] * y[i]; for (let q = 0; q < k; q++) A[p][q] += v[p] * v[q]; }
    });
    for (let p = 1; p < k; p++) A[p][p] += 1e-6;
    const w = solve(A, b);
    if (!w) return null;
    const neg = active.findIndex((_, i) => w[i + 1] < 0);
    if (neg === -1) {
      const coef = {};
      names.forEach((n) => (coef[n] = 0));
      active.forEach((a, i) => (coef[names[a]] = w[i + 1]));
      const pred = rows.map((r) => w[0] + active.reduce((s, a, i) => s + w[i + 1] * r[a], 0));
      const my = mean(y);
      const ssTot = sum(y.map((v) => (v - my) ** 2));
      const ssRes = sum(y.map((v, i) => (v - pred[i]) ** 2));
      return { intercept: w[0], coef, r2: ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0 };
    }
    active = active.filter((_, i) => i !== neg);
  }
  return null;
}

export function analyzeServiceTimes({ orders, menu }) {
  const MAX_MIN = 6 * 60; // an order "served" the next day is a forgotten record, not a real wait
  const menuMap = Object.fromEntries(menu.map((m) => [m.id, m]));
  const live = orders.filter((o) => o.status !== "cancelled" && o.placedAt);
  const byLine = new Map();
  live.forEach((o) => { (byLine.get(o.line) || byLine.set(o.line, []).get(o.line)).push(o); });
  byLine.forEach((list) => list.sort((a, b) => new Date(a.placedAt) - new Date(b.placedAt)));

  const rows = [];
  let excluded = 0;
  live.forEach((o) => {
    if (!DONE.includes(o.status) || !o.servedAt) return;
    const placed = new Date(o.placedAt).getTime();
    const total = (new Date(o.servedAt).getTime() - placed) / 60000;
    if (total < 0 || total > MAX_MIN) { excluded++; return; }
    const ready = o.readyAt ? new Date(o.readyAt).getTime() : null;
    const kitchen = ready != null ? (ready - placed) / 60000 : null;
    const delivery = ready != null ? (new Date(o.servedAt).getTime() - ready) / 60000 : null;
    // Orders for the same department still being worked on when this one arrived.
    let ahead = 0;
    for (const other of byLine.get(o.line) || []) {
      if (other.id === o.id) continue;
      const op = new Date(other.placedAt).getTime();
      if (op >= placed) break;
      if (placed - op > 3 * 3600000) continue;
      const end = other.readyAt ? new Date(other.readyAt).getTime() : other.servedAt ? new Date(other.servedAt).getTime() : placed + 1;
      if (end > placed) ahead++;
    }
    const d = new Date(o.placedAt);
    rows.push({
      id: o.id, line: o.line, total, kitchen, delivery, ahead,
      prep: orderPrepMinutes(o), hour: d.getHours(), weekday: d.getDay(),
      menuIds: o.items.map((it) => it.menuId).filter(Boolean),
    });
  });

  const out = { n: rows.length, excluded, overall: describe(rows.map((r) => r.total)), kitchen: null, delivery: null, byLine: {}, byHour: [], slowDishes: [], model: null, estimateMean: null };
  if (rows.length === 0) return out;
  out.kitchen = describe(rows.filter((r) => r.kitchen != null).map((r) => r.kitchen));
  out.delivery = describe(rows.filter((r) => r.delivery != null).map((r) => r.delivery));
  [...new Set(rows.map((r) => r.line))].forEach((line) => { out.byLine[line] = describe(rows.filter((r) => r.line === line).map((r) => r.total)); });
  out.estimateMean = mean(rows.map((r) => r.prep));

  for (let h = 0; h < 24; h++) {
    const hr = rows.filter((r) => r.hour === h);
    if (hr.length) out.byHour.push({ hour: h, n: hr.length, mean: mean(hr.map((r) => r.total)) });
  }
  const perDish = new Map();
  rows.forEach((r) => new Set(r.menuIds).forEach((id) => (perDish.get(id) || perDish.set(id, []).get(id)).push(r.total)));
  out.slowDishes = [...perDish.entries()]
    .filter(([, v]) => v.length >= 5)
    .map(([id, v]) => ({ menuId: id, dish: menuMap[id]?.name || "Unknown dish", n: v.length, mean: mean(v) }))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 5);

  if (rows.length >= NEEDS.serviceOrders) {
    const fit = fitLinear(rows.map((r) => [r.prep, r.ahead]), rows.map((r) => r.total), ["prep", "ahead"]);
    if (fit) out.model = { n: rows.length, base: fit.intercept, perPrepMinute: fit.coef.prep, perOrderAhead: fit.coef.ahead, r2: fit.r2 };
  }
  return out;
}
export const predictWait = (model, prepMinutes, ordersAhead) =>
  model ? Math.max(0, model.base + model.perPrepMinute * prepMinutes + model.perOrderAhead * ordersAhead) : null;

// ---------------------------------------------------------------------------------------
// 3. When customers order, and what they order.
// ---------------------------------------------------------------------------------------
export const DAYPARTS = [
  { key: "morning", label: "Morning (6-11)", from: 6, to: 11 },
  { key: "lunch", label: "Lunch (11-15)", from: 11, to: 15 },
  { key: "afternoon", label: "Afternoon (15-18)", from: 15, to: 18 },
  { key: "evening", label: "Evening (18-23)", from: 18, to: 23 },
];
const daypartOf = (h) => DAYPARTS.find((p) => h >= p.from && h < p.to)?.key || "late";

export function analyzeDemand({ orders, menu }) {
  const menuMap = Object.fromEntries(menu.map((m) => [m.id, m]));
  const active = orders.filter((o) => o.status !== "cancelled" && o.placedAt);
  // A table's cart is one "visit" even when it was split across kitchen and barista.
  const visits = groupOrdersByGroupId(active).map((g) => {
    const t = Math.min(...g.map((o) => new Date(o.placedAt).getTime()));
    const items = {};
    g.forEach((o) => o.items.forEach((it) => { items[it.menuId || it.name] = (items[it.menuId || it.name] || 0) + it.qty; }));
    return { t, items, names: Object.fromEntries(g.flatMap((o) => o.items.map((it) => [it.menuId || it.name, menuMap[it.menuId]?.name || it.name]))) };
  });
  const out = { visits: visits.length, days: new Set(visits.map((v) => dayKey(v.t))).size, grid: [], byHour: Array(24).fill(0), byWeekday: Array(7).fill(0), peakHours: [], topItems: [], byDaypart: {}, pairs: [] };
  if (!visits.length) return out;

  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  visits.forEach((v) => { const d = new Date(v.t); grid[d.getDay()][d.getHours()]++; out.byHour[d.getHours()]++; out.byWeekday[d.getDay()]++; });
  out.grid = grid;
  out.peakHours = out.byHour.map((n, hour) => ({ hour, n })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);

  const tally = (list) => {
    const m = new Map();
    list.forEach((v) => Object.entries(v.items).forEach(([k, q]) => { const e = m.get(k) || { id: k, name: v.names[k], qty: 0 }; e.qty += q; m.set(k, e); }));
    return [...m.values()].sort((a, b) => b.qty - a.qty);
  };
  out.topItems = tally(visits).slice(0, 8);
  [...DAYPARTS.map((p) => p.key), "late"].forEach((key) => {
    out.byDaypart[key] = tally(visits.filter((v) => daypartOf(new Date(v.t).getHours()) === key)).slice(0, 3);
  });

  // Dishes ordered together: "lift" above 1 means they show up together more than chance.
  const itemVisits = new Map();
  const pairCount = new Map();
  const multi = visits.filter((v) => Object.keys(v.items).length >= 1);
  multi.forEach((v) => {
    const ks = Object.keys(v.items).sort();
    ks.forEach((k) => itemVisits.set(k, (itemVisits.get(k) || 0) + 1));
    for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
      const key = `${ks[i]}|${ks[j]}`;
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
  });
  const names = Object.assign({}, ...visits.map((v) => v.names));
  out.pairs = [...pairCount.entries()]
    .filter(([, c]) => c >= 3)
    .map(([key, c]) => {
      const [a, b] = key.split("|");
      const lift = (c / multi.length) / ((itemVisits.get(a) / multi.length) * (itemVisits.get(b) / multi.length));
      return { a: names[a], b: names[b], count: c, lift };
    })
    .sort((x, y) => y.count - x.count)
    .slice(0, 5);
  return out;
}

// Expected visits per hour for a given day, from past same-weekday patterns with recent
// weeks counting more. Falls back to the all-days average while there's no history for
// that weekday.
export function forecastDay({ orders, targetDate }) {
  const active = orders.filter((o) => o.status !== "cancelled" && o.placedAt);
  const visits = groupOrdersByGroupId(active).map((g) => Math.min(...g.map((o) => new Date(o.placedAt).getTime())));
  const target = new Date(targetDate);
  const wd = target.getDay();
  const perDay = new Map();
  visits.forEach((t) => {
    const k = dayKey(t);
    const arr = perDay.get(k) || Array(24).fill(0);
    arr[new Date(t).getHours()]++;
    perDay.set(k, arr);
  });
  const targetKey = dayKey(target);
  const days = [...perDay.keys()].filter((k) => k !== targetKey).sort();
  const same = days.filter((k) => new Date(`${k}T12:00:00`).getDay() === wd);
  const use = same.length ? same : days;
  if (!use.length) return null;
  let wSum = 0;
  const hours = Array(24).fill(0);
  use.slice().reverse().forEach((k, i) => {
    const w = 0.6 ** i;
    wSum += w;
    perDay.get(k).forEach((n, h) => { hours[h] += n * w; });
  });
  return { hours: hours.map((h) => h / wSum), basedOnDays: use.length, sameWeekday: same.length > 0 };
}

// ---------------------------------------------------------------------------------------
// 4. Stock runway and dish margins.
// ---------------------------------------------------------------------------------------
export function stockRunway({ inventory, stockEvents, now = Date.now(), windowDays = 14 }) {
  const firstEvent = stockEvents.reduce((m, e) => Math.min(m, new Date(e.date).getTime()), Infinity);
  if (!isFinite(firstEvent)) return [];
  const days = Math.min(windowDays, Math.max(1, (now - firstEvent) / DAY_MS));
  const since = now - windowDays * DAY_MS;
  const used = new Map();
  stockEvents.forEach((e) => {
    if (e.type !== "out" || e.reason !== "usage" || e.source === "auto_deduction") return;
    if (new Date(e.date).getTime() < since) return;
    used.set(e.invId, (used.get(e.invId) || 0) + e.quantity);
  });
  return inventory
    .filter((i) => (used.get(i.id) || 0) > 0)
    .map((i) => {
      const perDay = used.get(i.id) / days;
      return { invId: i.id, name: i.name, unit: i.unit, quantity: i.quantity, perDay, daysLeft: i.quantity / perDay, reorderLevel: i.reorderLevel };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export function dishMargins({ menu, inventory }) {
  const invMap = Object.fromEntries(inventory.map((i) => [i.id, i]));
  return menu
    .filter((m) => m.active !== false && m.price > 0 && (m.recipe || []).length > 0)
    .map((m) => {
      const priced = m.recipe.filter((r) => (invMap[r.invId]?.costPerUnit || 0) > 0);
      const cost = sum(m.recipe.map((r) => r.qty * (invMap[r.invId]?.costPerUnit || 0)));
      return { menuId: m.id, name: m.name, price: m.price, cost, complete: priced.length === m.recipe.length, marginPct: (m.price - cost) / m.price };
    });
}

// ---------------------------------------------------------------------------------------
// 5. Plain-language feedback, built from everything above.
// ---------------------------------------------------------------------------------------
const SEV_RANK = { act: 3, watch: 2, info: 1, good: 0 };

export function buildSuggestions({ orders, menu, inventory, stockEvents, fixedCosts, now = Date.now() }) {
  const ready = dataReadiness({ orders, stockEvents });
  const learned = learnIngredientUsage({ orders, menu, inventory, stockEvents });
  const service = analyzeServiceTimes({ orders, menu });
  const demand = analyzeDemand({ orders, menu });
  const runway = stockRunway({ inventory, stockEvents, now });
  const margins = dishMargins({ menu, inventory });

  const items = [];
  const add = (s) => items.push(s);
  const mins = (v) => `${Math.round(v)} min`;
  const hourLabel = (h) => `${pad(h)}:00`;

  // ----- service speed
  if (service.n >= NEEDS.serviceOrders) {
    const avg = service.overall.mean;
    if (service.estimateMean > 0 && avg > service.estimateMean * 1.4 + 3) {
      add({ id: "slow-service", area: "speed", severity: avg > service.estimateMean * 2 ? "act" : "watch",
        title: "Orders are taking longer than planned",
        detail: `On average an order takes ${mins(avg)} from being placed to reaching the table, but the menu's own prep times add up to about ${mins(service.estimateMean)}. Check whether prep times on the menu are realistic, or whether the kitchen is short-handed at busy hours.` });
    } else {
      add({ id: "service-ok", area: "speed", severity: "good", title: "Service speed looks healthy",
        detail: `Orders take about ${mins(avg)} on average, in line with planned prep times.` });
    }
    const slowHours = service.byHour.filter((h) => h.n >= 5).sort((a, b) => b.mean - a.mean);
    if (slowHours.length >= 3 && slowHours[0].mean > avg * 1.3) {
      add({ id: "slow-hour", area: "speed", severity: "watch", title: `${hourLabel(slowHours[0].hour)} is the slowest hour`,
        detail: `Orders placed around ${hourLabel(slowHours[0].hour)} take about ${mins(slowHours[0].mean)}, against ${mins(avg)} for the day. Having extra hands ready before that hour should help.` });
    }
    if (service.delivery && service.delivery.n >= 10 && service.delivery.mean > 8) {
      add({ id: "slow-delivery", area: "speed", severity: service.delivery.mean > 15 ? "act" : "watch", title: "Food waits after it's ready",
        detail: `Finished orders sit about ${mins(service.delivery.mean)} before they're marked served. Customers may be getting cold food, so it's worth checking who is responsible for delivery at busy times.` });
    }
  } else {
    add({ id: "service-learning", area: "speed", severity: "info", title: "Still learning your service speed",
      detail: `${service.n} of ${NEEDS.serviceOrders} completed orders needed so far. Orders need to be marked ready and served for this to work.` });
  }

  // ----- ingredient control
  if (learned.nDays >= NEEDS.ingredientDays) {
    const over = learned.ingredients.filter((r) => r.ratio != null && r.expectedTotal > 0 && r.ratio > 1.2 && r.recordedTotal - r.expectedTotal > 0.5);
    const under = learned.ingredients.filter((r) => r.ratio != null && r.expectedTotal > 0 && r.ratio < 0.7 && r.expectedTotal - r.recordedTotal > 0.5);
    if (over.length) {
      const top = over.sort((a, b) => b.ratio - a.ratio).slice(0, 3);
      add({ id: "overuse", area: "stock", severity: top[0].ratio > 1.5 ? "act" : "watch", title: "More ingredients are leaving the store than orders explain",
        detail: `${top.map((r) => `${r.name} (${Math.round((r.ratio - 1) * 100)}% more than the recipes say)`).join(", ")}. This usually means over-sized portions, waste, or stock leaving for other uses. Worth checking in the kitchen.` });
    }
    if (under.length) {
      const top = under.sort((a, b) => a.ratio - b.ratio).slice(0, 3);
      add({ id: "underrecorded", area: "stock", severity: "watch", title: "Some stock-outs may not be getting recorded",
        detail: `${top.map((r) => r.name).join(", ")} ${top.length === 1 ? "is" : "are"} being recorded as used much less than the orders would need. Either the recipes are too generous, or the storekeeper is missing entries.` });
    }
    if (!over.length && !under.length) {
      add({ id: "stock-ok", area: "stock", severity: "good", title: "Stock use matches what was ordered",
        detail: "What the storekeeper records going out lines up with what the orders should have used." });
    }
    const gaps = ready.orderDays - ready.overlapDays;
    if (gaps >= 3) {
      add({ id: "record-gaps", area: "stock", severity: "watch", title: `Nothing recorded on ${gaps} busy days`,
        detail: "There were orders on those days but no stock-out was recorded at all. Those days can't be checked for missing stock." });
    }
  } else {
    add({ id: "stock-learning", area: "stock", severity: "info", title: "Still learning how much each dish uses",
      detail: `${learned.nDays} of ${NEEDS.ingredientDays} days with both orders and recorded stock-outs so far. Keep recording stock-out daily and this will fill in.` });
  }

  // ----- running out
  const soon = runway.filter((r) => r.daysLeft < 3 && ready.usageDays >= NEEDS.runwayDays);
  if (soon.length) {
    add({ id: "run-out", area: "stock", severity: soon.some((r) => r.daysLeft < 1) ? "act" : "watch", title: `${soon.length} item${soon.length === 1 ? "" : "s"} likely to run out within 3 days`,
      detail: `${soon.slice(0, 5).map((r) => `${r.name} (about ${r.daysLeft < 1 ? "less than a day" : `${Math.round(r.daysLeft)} days`} left)`).join(", ")}. Based on how fast each one has been used recently.` });
  }

  // ----- dish margins
  const losing = margins.filter((m) => m.complete && m.marginPct < 0);
  const thin = margins.filter((m) => m.complete && m.marginPct >= 0 && m.marginPct < 0.3);
  if (losing.length) {
    add({ id: "margin-loss", area: "costs", severity: "act", title: "Some dishes sell for less than their ingredients cost",
      detail: `${losing.slice(0, 4).map((m) => m.name).join(", ")}. Raise the price or check the recipe amounts.` });
  } else if (thin.length) {
    add({ id: "margin-thin", area: "costs", severity: "watch", title: "Some dishes have a thin margin",
      detail: `${thin.slice(0, 4).map((m) => `${m.name} (${Math.round(m.marginPct * 100)}% left after ingredients)`).join(", ")}. A small price rise would help.` });
  }

  // ----- money, last 30 days
  const end = new Date(now);
  const start = new Date(now - 29 * DAY_MS);
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const pl = profitLossForPeriod(inventory, orders, menu, stockEvents, fixedCosts, iso(start), iso(end));
  if (pl.revenue.total > 0) {
    const foodPct = pl.recordedCost / pl.revenue.total;
    if (pl.recordedCost > 0 && foodPct > 0.4) {
      add({ id: "food-cost", area: "costs", severity: foodPct > 0.5 ? "act" : "watch", title: "Ingredients are eating a big share of sales",
        detail: `Over the last 30 days, ingredients cost about ${Math.round(foodPct * 100)}% of money taken in. Restaurants usually aim for 25-40%.` });
    }
    if (pl.profit < 0) {
      add({ id: "loss", area: "sales", severity: "act", title: "The business made a loss in the last 30 days",
        detail: `Money in was RWF ${Math.round(pl.revenue.total).toLocaleString("en-US")}, against RWF ${Math.round(pl.recordedCost + pl.fixed.total).toLocaleString("en-US")} of ingredient and fixed costs.` });
    } else {
      add({ id: "profit", area: "sales", severity: "good", title: "The business is in profit over the last 30 days",
        detail: `About RWF ${Math.round(pl.profit).toLocaleString("en-US")} left after ingredients and fixed costs.` });
    }
    if (pl.fixed.total === 0) {
      add({ id: "no-fixed", area: "costs", severity: "info", title: "No fixed costs recorded",
        detail: "Add rent, salaries and utilities under Fixed Costs, otherwise profit looks better than it really is." });
    }
  }

  // ----- busy times
  if (demand.visits >= NEEDS.demandOrders && demand.days >= NEEDS.demandDays && demand.peakHours.length) {
    const p = demand.peakHours.map((x) => hourLabel(x.hour)).join(", ");
    add({ id: "peak", area: "sales", severity: "info", title: `Busiest hours: ${p}`,
      detail: "Most customers order around these times. Prepare ingredients and have the full team ready before them." });
  }

  // ----- menu
  const lastDay = now - 30 * DAY_MS;
  if (demand.days >= 30) {
    const orderedRecently = new Set();
    orders.forEach((o) => { if (new Date(o.placedAt).getTime() >= lastDay) o.items.forEach((it) => it.menuId && orderedRecently.add(it.menuId)); });
    const dead = menu.filter((m) => m.active !== false && !orderedRecently.has(m.id));
    if (dead.length) {
      add({ id: "dead-menu", area: "sales", severity: "info", title: `${dead.length} menu item${dead.length === 1 ? "" : "s"} not ordered in 30 days`,
        detail: `${dead.slice(0, 5).map((m) => m.name).join(", ")}${dead.length > 5 ? " and more" : ""}. Consider hiding them to keep the menu simple.` });
    }
  }

  // ----- cancellations
  const total = orders.length;
  const cancelled = orders.filter((o) => o.status === "cancelled").length;
  if (total >= 20 && cancelled / total > 0.1) {
    add({ id: "cancels", area: "sales", severity: "watch", title: "A lot of orders are being cancelled",
      detail: `${Math.round((cancelled / total) * 100)}% of orders were cancelled. Check the cancellation reasons in Orders for a pattern.` });
  }

  // ----- staff orders
  const staff = orders.filter((o) => o.isStaffOrder && o.status === "billed");
  const billedTotal = sum(orders.filter((o) => o.status === "billed").map((o) => o.total));
  if (staff.length >= 5 && billedTotal > 0 && sum(staff.map((o) => o.total)) / billedTotal > 0.15) {
    add({ id: "staff-orders", area: "costs", severity: "watch", title: "Staff orders are a large share of sales",
      detail: "More than 15% of billed money comes from staff meals at reduced prices." });
  }

  items.sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

  // Traffic light per area: "unknown" until there's enough data to judge it, then the worst
  // thing found there -- or "good" when there was enough data and nothing is wrong.
  const judgeable = {
    sales: pl.revenue.total > 0,
    costs: margins.some((m) => m.complete) || (pl.revenue.total > 0 && pl.recordedCost > 0),
    speed: service.n >= NEEDS.serviceOrders,
    stock: learned.nDays >= NEEDS.ingredientDays,
  };
  const areas = {};
  Object.keys(judgeable).forEach((a) => {
    if (!judgeable[a]) { areas[a] = "unknown"; return; }
    const found = items.filter((i) => i.area === a && i.severity !== "info");
    areas[a] = found.reduce((w, i) => (SEV_RANK[i.severity] > SEV_RANK[w] ? i.severity : w), "good");
  });

  return { items, areas, ready, learned, service, demand, runway, margins, pl };
}
