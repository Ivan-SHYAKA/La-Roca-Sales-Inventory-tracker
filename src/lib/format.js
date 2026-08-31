import { SECTION_BY_TABLE } from "./constants";

export const fmt = (n) => Math.round(n || 0).toLocaleString("en-US");
export const mins = (ms) => Math.max(0, Math.round(ms / 60000));
export const now = () => new Date().toISOString();
// Displays a duration in whatever unit reads naturally at its size, instead of always
// showing minutes — "42 min" is fine, but a three-week-old order shouldn't read as
// "elapsed 30240 min". Steps up through minutes -> hours -> days -> weeks -> months -> years.
export function humanizeDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 60) return `${totalMin} min`;
  const totalHours = Math.floor(totalMin / 60);
  if (totalHours < 24) {
    const remMin = totalMin % 60;
    return remMin ? `${totalHours}h ${remMin}m` : `${totalHours}h`;
  }
  const totalDays = Math.floor(totalHours / 24);
  if (totalDays < 7) return `${totalDays} day${totalDays === 1 ? "" : "s"}`;
  if (totalDays < 30) {
    const totalWeeks = Math.floor(totalDays / 7);
    return `${totalWeeks} week${totalWeeks === 1 ? "" : "s"}`;
  }
  if (totalDays < 365) {
    const totalMonths = Math.floor(totalDays / 30);
    return `${totalMonths} month${totalMonths === 1 ? "" : "s"}`;
  }
  const totalYears = Math.floor(totalDays / 365);
  return `${totalYears} year${totalYears === 1 ? "" : "s"}`;
}
// Every order needs a human-readable identity somewhere in the UI. Table/room number
// is the primary identifier now (so staff don't have to ask/type a client name for
// every walk-in); client name is an optional fallback for when neither was given.
// For restaurant/coffee-shop tables that match the known floor layout, the section is
// appended too — staff already know the floor plan, so this helps kitchen/barista route
// or prioritize by area without walking over to check.
export const orderLabel = (o) => {
  if (!o.tableNumber) return o.client || "Guest";
  if (o.line === "accommodations") return `Room ${o.tableNumber}`;
  const section = SECTION_BY_TABLE[o.tableNumber.toLowerCase()];
  return section ? `Table ${o.tableNumber} · Section ${section}` : `Table ${o.tableNumber}`;
};
