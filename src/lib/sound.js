// A short, synthesized chime for new-order alerts — no audio asset needed, and it degrades
// silently on browsers/contexts where AudioContext is blocked (e.g. no user gesture yet).
export function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch (_) {
    // Audio not available in this context — the toast itself still shows.
  }
}
