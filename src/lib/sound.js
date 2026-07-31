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

// A lower, two-beep tone for errors/failed actions — deliberately distinct from playChime
// (which is a single pleasant tone for "a new order arrived") so the two are tellable
// apart by ear alone, without looking up at the toast.
export function playAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.16].forEach((offset) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.type = "square";
      o.frequency.value = 330;
      const start = ctx.currentTime + offset;
      g.gain.setValueAtTime(0.12, start);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
      o.start(start);
      o.stop(start + 0.14);
    });
  } catch (_) {
    // Audio not available in this context — the toast itself still shows.
  }
}
