import { SECTION_BY_TABLE } from "./constants";

export const fmt = (n) => Math.round(n || 0).toLocaleString("en-US");
export const mins = (ms) => Math.max(0, Math.round(ms / 60000));
export const now = () => new Date().toISOString();
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
