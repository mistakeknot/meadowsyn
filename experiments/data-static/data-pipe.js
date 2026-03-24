/**
 * DataPipe — dual-transport data pipe with ring buffer history.
 *
 * Usage (SSE — live streaming):
 *   const pipe = new DataPipe({ sse: 'http://localhost:8401/stream', url: 'snapshot.json' });
 *   pipe.subscribe(snapshot => console.log(snapshot));
 *   pipe.start();
 *
 * Usage (polling only):
 *   const pipe = new DataPipe({ url: 'snapshot.json', interval: 5000 });
 *   pipe.subscribe(snapshot => console.log(snapshot));
 *   pipe.start();
 *
 * SSE is primary transport when configured. Falls back to polling if SSE
 * fails 3 consecutive times or is not configured.
 * Works with file:// (pass a generator function as fallback) and https://.
 */
export class DataPipe {
  /**
   * @param {object} opts
   * @param {string}   [opts.sse]         - SSE endpoint URL (primary transport)
   * @param {string}   [opts.url]         - URL to poll (fallback transport)
   * @param {Function} [opts.generator]   - Fallback: () => snapshot (for file:// or mock)
   * @param {number}   [opts.interval]    - Poll interval ms (default 5000)
   * @param {number}   [opts.bufferSize]  - Ring buffer capacity (default 720 = 1hr at 5s)
   */
  constructor({ sse, url, generator, interval = 5000, bufferSize = 720 } = {}) {
    this._sseUrl = sse || null;
    this._url = url;
    this._generator = generator;
    this._interval = interval;
    this._bufferSize = bufferSize;

    this._buffer = [];
    this._head = 0;           // next write index (ring buffer)
    this._count = 0;          // total items stored
    this._latest = null;
    this._lastOk = 0;         // timestamp of last successful fetch
    this._subscribers = new Set();
    this._transportListeners = new Set();
    this._timer = null;
    this._retryDelay = 0;     // current backoff delay (0 = no retry pending)
    this._retryTimer = null;

    // SSE state
    this._eventSource = null;
    this._sseFailCount = 0;
    this._transport = 'disconnected'; // 'sse' | 'polling' | 'disconnected'

    // Pre-allocate ring buffer slots
    this._buffer.length = bufferSize;
  }

  /** Subscribe to snapshot updates. Returns unsubscribe function. */
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  /** Unsubscribe a callback. */
  unsubscribe(fn) {
    this._subscribers.delete(fn);
  }

  /** Subscribe to transport changes ('sse'|'polling'|'disconnected'). Returns unsubscribe. */
  onTransport(fn) {
    this._transportListeners.add(fn);
    return () => this._transportListeners.delete(fn);
  }

  /** Current transport mode. */
  get transport() {
    return this._transport;
  }

  /** Start data collection. Tries SSE first if configured, otherwise polls. */
  start() {
    if (this._sseUrl) {
      this._startSSE();
    } else {
      this._startPolling();
    }
  }

  /** Stop all transports. */
  stop() {
    this._stopSSE();
    this._stopPolling();
    this._setTransport('disconnected');
  }

  /** Get the latest snapshot (or null if none yet). */
  getLatest() {
    return this._latest;
  }

  /** Get buffered history, oldest-first. */
  getHistory() {
    if (this._count === 0) return [];
    const size = Math.min(this._count, this._bufferSize);
    const result = new Array(size);
    const start = this._count >= this._bufferSize
      ? this._head  // buffer is full, head points to oldest
      : 0;
    for (let i = 0; i < size; i++) {
      result[i] = this._buffer[(start + i) % this._bufferSize];
    }
    return result;
  }

  /** True if last successful fetch was more than 3x interval ago. */
  isStale() {
    if (this._lastOk === 0) return false;  // haven't fetched yet
    return (Date.now() - this._lastOk) > (this._interval * 3);
  }

  /** Total snapshots received since start. */
  get snapshotCount() {
    return this._count;
  }

  /** Current poll interval in ms. */
  get interval() {
    return this._interval;
  }

  // --- SSE Transport ---

  _startSSE() {
    if (this._eventSource) return;

    try {
      this._eventSource = new EventSource(this._sseUrl);
    } catch {
      this._fallbackToPolling();
      return;
    }

    this._eventSource.addEventListener('snapshot', (e) => {
      try {
        const snapshot = JSON.parse(e.data);
        this._sseFailCount = 0;
        this._pushSnapshot(snapshot);
        this._setTransport('sse');
      } catch { /* malformed JSON — skip */ }
    });

    this._eventSource.addEventListener('delta', (e) => {
      try {
        const delta = JSON.parse(e.data);
        this._applyDelta(delta);
      } catch { /* skip */ }
    });

    this._eventSource.addEventListener('open', () => {
      this._sseFailCount = 0;
      this._setTransport('sse');
      // Stop polling if it was running as fallback
      this._stopPolling();
    });

    this._eventSource.addEventListener('error', () => {
      this._sseFailCount++;
      if (this._sseFailCount >= 3) {
        this._fallbackToPolling();
      }
      // EventSource auto-reconnects, so we just count failures
    });
  }

  _stopSSE() {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  _fallbackToPolling() {
    this._stopSSE();
    this._startPolling();
  }

  _applyDelta(delta) {
    if (!this._latest || delta.type !== 'agent_status') return;
    // Update the matching agent in the latest snapshot
    const agents = this._latest.fleet?.agents;
    if (!agents) return;
    for (const a of agents) {
      const name = a.agent || a.session_name;
      if (name === delta.agent) {
        a.status = delta.to === 'absent' ? 'offline' : delta.to;
        break;
      }
    }
    // Re-notify with updated snapshot
    this._notify(this._latest);
  }

  // --- Polling Transport ---

  _startPolling() {
    if (this._timer) return;
    this._setTransport('polling');
    this._poll();  // immediate first poll
    this._timer = setInterval(() => this._poll(), this._interval);
  }

  _stopPolling() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      this._retryDelay = 0;
    }
  }

  async _poll() {
    try {
      const snapshot = await this._fetch();
      if (snapshot) {
        this._pushSnapshot(snapshot);
        this._retryDelay = 0;  // reset backoff on success
      }
    } catch {
      this._scheduleRetry();
    }
  }

  async _fetch() {
    // Try generator first (file:// or mock mode)
    if (this._generator) {
      const data = await this._generator();
      if (data && !data.error) return data;
    }

    // Try URL fetch
    if (this._url) {
      const res = await fetch(this._url, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (!data.error) return data;
      }
    }

    return null;
  }

  // --- Shared ---

  _pushSnapshot(snapshot) {
    this._buffer[this._head] = snapshot;
    this._head = (this._head + 1) % this._bufferSize;
    this._count++;
    this._latest = snapshot;
    this._lastOk = Date.now();
    this._notify(snapshot);
  }

  _notify(snapshot) {
    for (const fn of this._subscribers) {
      try { fn(snapshot); } catch { /* subscriber errors don't break the pipe */ }
    }
  }

  _setTransport(mode) {
    if (this._transport === mode) return;
    this._transport = mode;
    for (const fn of this._transportListeners) {
      try { fn(mode); } catch { /* listener errors don't break the pipe */ }
    }
  }

  _scheduleRetry() {
    if (this._retryTimer) return;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s max
    this._retryDelay = Math.min(
      (this._retryDelay || 500) * 2,
      30_000
    );
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._poll();
    }, this._retryDelay);
  }
}
