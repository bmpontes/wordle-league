'use strict';

/**
 * Limitador simples em memória (janela fixa). Adequado a uma instância única;
 * os contadores reiniciam se o processo reiniciar.
 */
class RateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.timer = setInterval(() => this.prune(), Math.min(windowMs, 60000));
    this.timer.unref();
  }

  entry(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, e);
    }
    return e;
  }

  isBlocked(key) {
    const e = this.hits.get(key);
    return Boolean(e && e.resetAt > Date.now() && e.count >= this.max);
  }

  retryAfterSeconds(key) {
    const e = this.hits.get(key);
    return e ? Math.max(1, Math.ceil((e.resetAt - Date.now()) / 1000)) : 0;
  }

  hit(key) {
    const e = this.entry(key);
    e.count++;
    return e.count;
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune() {
    const now = Date.now();
    for (const [k, e] of this.hits) if (e.resetAt <= now) this.hits.delete(k);
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { RateLimiter };
