// Pure auto-quality state machine, kept import-free so it can be unit-tested
// with `node --test` (game3d.js needs a WebGL context and can't be).

export const QUALITY = {
  high:   { ratio: 1.75, post: true,  msaa: 4, shadow: 2048, shadows: true,  grass: 1 },
  medium: { ratio: 1.25, post: true,  msaa: 0, shadow: 2048, shadows: true,  grass: 0.6 },
  low:    { ratio: 1,    post: false, msaa: 0, shadow: 1024, shadows: true,  grass: 0.35 },
  lowest: { ratio: 0.8,  post: false, msaa: 0, shadow: 1024, shadows: false, grass: 0 },
};
export const TIERS = ['high', 'medium', 'low', 'lowest'];
export const TIER_LABELS = { high: 'High', medium: 'Medium', low: 'Low', lowest: 'Lowest' };

export const EMA_ALPHA = 0.05;
export const SLOW_EMA = 1 / 40;
export const SLOW_AFTER = 2.5;
export const FAST_EMA = 1 / 55;
export const UP_AFTER = 10;
export const MAX_DROPS = 4;

export function createPerf() {
  return { ema: 1 / 60, slowFor: 0, fastFor: 0, drops: {} };
}

// Mutates `perf` with the latest frame time and returns the tier that should
// be in effect now: `tier` unchanged, or the tier one step up or down.
export function nextTier(perf, tier, dt) {
  perf.ema += (dt - perf.ema) * EMA_ALPHA;
  perf.slowFor = perf.ema > SLOW_EMA ? perf.slowFor + dt : 0;
  perf.fastFor = perf.ema < FAST_EMA ? perf.fastFor + dt : 0;

  const i = TIERS.indexOf(tier);
  if (perf.slowFor >= SLOW_AFTER && i < TIERS.length - 1) {
    perf.drops[tier] = (perf.drops[tier] || 0) + 1;
    perf.slowFor = 0;
    perf.fastFor = 0;
    perf.ema = 1 / 60;
    return TIERS[i + 1];
  }
  if (i > 0) {
    const up = TIERS[i - 1];
    const drops = perf.drops[up] || 0;
    if (drops < MAX_DROPS && perf.fastFor >= UP_AFTER * 2 ** Math.max(0, drops - 1)) {
      perf.slowFor = 0;
      perf.fastFor = 0;
      perf.ema = 1 / 60;
      return up;
    }
  }
  return tier;
}
