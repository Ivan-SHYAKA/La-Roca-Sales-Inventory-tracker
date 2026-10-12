import { supabase } from "../supabaseClient";
import { mapLoan, mapLoanRepayment, mapCashDay, check } from "./mappers";

// Loans, repayments and the cash book. Manager only (row-level security returns nothing to
// anyone else and rejects their writes).
export async function fetchLoans() {
  const [loans, reps] = await Promise.all([
    supabase.from("loans").select("*").order("loan_date", { ascending: false }),
    supabase.from("loan_repayments").select("*").order("paid_on", { ascending: true }),
  ]);
  check(loans.error);
  check(reps.error);
  return { loans: (loans.data || []).map(mapLoan), repayments: (reps.data || []).map(mapLoanRepayment) };
}

export async function addLoan({ person, amount, date, note }, session) {
  const { error } = await supabase.from("loans").insert({
    person_name: person.trim(),
    amount,
    loan_date: date,
    note: (note || "").trim() || null,
    created_by: session.id,
    created_by_name: session.name,
  });
  check(error);
}

export async function addLoanRepayment({ loanId, amount, date, note }, session) {
  const { error } = await supabase.from("loan_repayments").insert({
    loan_id: loanId,
    amount,
    paid_on: date,
    note: (note || "").trim() || null,
    created_by: session.id,
    created_by_name: session.name,
  });
  check(error);
}

export async function removeLoan(id) {
  const { error } = await supabase.from("loans").delete().eq("id", id);
  check(error);
}

export async function fetchCashBook() {
  const { data, error } = await supabase.from("cash_book_days").select("*").order("day", { ascending: true });
  check(error);
  return (data || []).map(mapCashDay);
}

// One row per day; saving a day again replaces its figures.
export async function saveCashBookDay({ day, openingCash, openingMomo, closingCash, closingMomo, note }, session) {
  const { error } = await supabase.from("cash_book_days").upsert({
    day,
    opening_cash: openingCash,
    opening_momo: openingMomo,
    closing_cash: closingCash,
    closing_momo: closingMomo,
    note: note || null,
    updated_by: session.id,
    updated_by_name: session.name,
    updated_at: new Date().toISOString(),
  }, { onConflict: "day" });
  check(error);
}
