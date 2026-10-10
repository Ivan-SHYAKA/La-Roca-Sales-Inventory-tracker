import { check } from "./mappers";

// The database hands back at most 1000 rows per request, however many match. Without this,
// once there were more than 1000 orders (or stock records) every screen quietly worked
// from only the newest 1000 -- totals, reports and anything that learns from history
// would all be wrong with no error shown. This keeps asking for the next page until a
// short one comes back.
//
// `makeQuery` must build a fresh query each time it's called and use a stable, total order
// (a unique column last) so pages never overlap or skip rows.
export async function fetchAllRows(makeQuery, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    check(error);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}
