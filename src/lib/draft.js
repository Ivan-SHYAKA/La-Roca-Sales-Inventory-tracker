// Per-device "resume what I was typing" scratch storage for in-progress forms
// (new order cart, new menu item, stock-in/out form). Not shared across devices
// and not part of the business data model, so plain localStorage is fine here —
// this replaces the prototype's window.storage calls with isGlobal=false.
export function draftGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
export function draftSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* storage unavailable — draft resume is best-effort only */ }
}
export function draftClear(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) { /* ignore */ }
}
