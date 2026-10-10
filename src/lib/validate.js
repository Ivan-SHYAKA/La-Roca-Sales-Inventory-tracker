// Small checks shared by the forms. A form lists what's still missing (in plain words), shows
// that under its Save button, and keeps Save switched off until the list is empty.
export const isBlank = (v) => v == null || String(v).trim() === "";
export const isNumber = (v) => !isBlank(v) && Number.isFinite(Number(v));
export const isPositive = (v) => isNumber(v) && Number(v) > 0;
export const isNonNegative = (v) => isNumber(v) && Number(v) >= 0;
