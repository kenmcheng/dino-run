// Basic guardrails against unbounded resource use: a ceiling on concurrent
// rooms and connections, a per-IP connection cap, and a token-bucket rate
// limit on incoming WebSocket messages. All tunable via env vars.

export function envInt(name, def) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
}

export const LIMITS = Object.freeze({
  maxRooms: envInt('MAX_ROOMS', 200),
  maxConnections: envInt('MAX_CONNECTIONS', 500),
  maxConnectionsPerIp: envInt('MAX_CONNECTIONS_PER_IP', 16),
  msgRate: envInt('MSG_RATE', 150),
  msgBurst: envInt('MSG_BURST', 300),
  floodDrops: envInt('MSG_FLOOD_DROPS', 300),
  floodWindowMs: envInt('MSG_FLOOD_WINDOW_MS', 10000),
  trustProxy: process.env.TRUST_PROXY === '1',
});

// Token bucket: `hit()` returns 'ok' while tokens remain, 'drop' once they
// run out, and 'close' once drops pile up fast enough to look like a flood.
export class MessageLimiter {
  constructor({ rate, burst, floodDrops, floodWindowMs }, now = Date.now()) {
    this.rate = rate;
    this.burst = burst;
    this.floodDrops = floodDrops;
    this.floodWindowMs = floodWindowMs;
    this.tokens = burst;
    this.last = now;
    this.drops = 0;
    this.windowStart = now;
  }

  hit(now = Date.now()) {
    const elapsed = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + (elapsed * this.rate) / 1000);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 'ok';
    }
    if (now - this.windowStart >= this.floodWindowMs) {
      this.windowStart = now;
      this.drops = 0;
    }
    this.drops++;
    return this.drops >= this.floodDrops ? 'close' : 'drop';
  }
}

// Builds a MessageLimiter wired to the real LIMITS keys, so callers can't
// pass the wrong shape (see the msgRate/msgBurst vs rate/burst mismatch this
// fixes).
export function messageLimiter(limits = LIMITS, now = Date.now()) {
  return new MessageLimiter({
    rate: limits.msgRate,
    burst: limits.msgBurst,
    floodDrops: limits.floodDrops,
    floodWindowMs: limits.floodWindowMs,
  }, now);
}

// Map of ip -> open connection count. Keys are removed once the count hits
// zero, so the map cannot grow without bound.
export class IpCounter {
  constructor() { this.counts = new Map(); }

  add(ip) {
    const n = (this.counts.get(ip) || 0) + 1;
    this.counts.set(ip, n);
    return n;
  }

  remove(ip) {
    const n = (this.counts.get(ip) || 0) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
  }
}

// With `trustProxy`, the last X-Forwarded-For hop is the one the trusted
// proxy appended; the leftmost entry is client-controlled and unsafe to use.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const parts = String(xff).split(',');
      return parts[parts.length - 1].trim();
    }
  }
  return req.socket.remoteAddress || 'unknown';
}
