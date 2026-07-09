import { UtensilsCrossed, Coffee, BedDouble } from "lucide-react";

export const LINES = {
  restaurant: { label: "Restaurant", color: "#B54A28", icon: UtensilsCrossed },
  coffeeshop: { label: "Coffee Shop", color: "#46583F", icon: Coffee },
  accommodations: { label: "Accommodations", color: "#B8923F", icon: BedDouble },
};
export const ROLES = {
  manager: "Manager / Admin",
  waiter: "Waiter",
  sales: "Sales / Receptionist",
  kitchen: "Kitchen Staff",
  barista: "Barista",
  storekeeper: "Storekeeper",
};
// How many orders each department can realistically work on at the same time.
// Tune these to match real staffing/equipment.
export const DEPT_CAPACITY = { kitchen: 2, barista: 1 };
export const DEPT_FOR_LINE = { restaurant: "kitchen", coffeeshop: "barista", accommodations: "reception" };

// How the floor is physically laid out — every waiter already knows this, so surfacing
// the section alongside a table number lets kitchen/barista route/prioritize by area too.
// Room numbers (accommodations) aren't part of this layout and won't match any entry here.
export const TABLE_SECTIONS = [
  { section: 1, tables: ["1", "2", "3", "Counter"] },
  { section: 2, tables: ["11", "12"] },
  { section: 3, tables: ["21", "22", "23", "24"] },
  { section: 4, tables: ["31", "32", "33", "34", "35"] },
];
export const SECTION_BY_TABLE = Object.fromEntries(
  TABLE_SECTIONS.flatMap((s) => s.tables.map((t) => [t.toLowerCase(), s.section]))
);
