// Ordered command dispatcher.
//
// Every request to the TV goes through one FIFO queue:
// - one request in flight at a time, in the order they were enqueued;
// - a configurable gap between consecutive requests (GiTV drops keys that
//   arrive too quickly);
// - bounded size, so a huge paste can't create thousands of requests;
// - failed requests are never retried automatically: with an opaque no-cors
//   response we can't know whether the TV already executed the command;
// - when a text key fails, the remaining queued text is cancelled (and
//   reported back so the UI can offer it for an explicit retry) rather than
//   typed with a gap in the middle.
//
// Remote buttons pressed while text is queued are appended after that text,
// so the TV sees actions in the order the user performed them.

export const DEFAULT_INTERVAL_MS = 80;
export const DEFAULT_MAX_PENDING = 400;

/**
 * @typedef {object} Command
 * @property {"remote"|"text"|"probe"} kind
 * @property {string} url
 * @property {string} [addressSpace]
 * @property {string} [label]
 * @property {{char: string, keycode: string}} [token]  text commands only
 * @property {number} [id]  assigned by the queue
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class CommandQueue {
  #send;
  #pending = [];
  #inFlight = null;
  #running = false;
  #lastEnd = 0;
  #nextId = 1;
  #listeners = new Set();
  #idleWaiters = [];

  /**
   * @param {object} options
   * @param {(command: Command) => Promise<unknown>} options.send
   * @param {number} [options.intervalMs] minimum gap between requests
   * @param {number} [options.maxPending] maximum queued (not yet sent) commands
   * @param {number} [options.watchdogMs] hard limit per request, so a send()
   *   that never settles can't block the queue forever
   */
  constructor({ send, intervalMs = DEFAULT_INTERVAL_MS, maxPending = DEFAULT_MAX_PENDING, watchdogMs = 10000 }) {
    this.#send = send;
    this.intervalMs = intervalMs;
    this.maxPending = maxPending;
    this.watchdogMs = watchdogMs;
  }

  /** @param {(event: {type: string} & Record<string, any>) => void} listener */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(err);
      }
    }
  }

  get pendingCount() {
    return this.#pending.length;
  }

  get busy() {
    return this.#running;
  }

  get inFlight() {
    return this.#inFlight;
  }

  /** Number of queued (not yet dispatched) commands of a kind. */
  countPending(kind) {
    return this.#pending.filter((c) => c.kind === kind).length;
  }

  get freeSlots() {
    return Math.max(0, this.maxPending - this.#pending.length);
  }

  /** Enqueue one command. Returns false when the queue is full. */
  enqueue(command) {
    return this.enqueueAll([command]);
  }

  /**
   * Enqueue several commands atomically: either all are accepted, in order,
   * or none are (so a phrase is never half-queued).
   */
  enqueueAll(commands) {
    if (commands.length === 0) return true;
    if (commands.length > this.freeSlots) return false;
    for (const command of commands) {
      this.#pending.push({ ...command, id: this.#nextId++ });
    }
    this.#emit({ type: "change" });
    this.#pump();
    return true;
  }

  /**
   * Remove queued commands that haven't been dispatched yet. The request in
   * flight (if any) is not affected.
   * @param {(command: Command) => boolean} [predicate]
   * @returns {Command[]} the cancelled commands, in queue order
   */
  cancelPending(predicate = () => true) {
    const cancelled = [];
    this.#pending = this.#pending.filter((c) => {
      if (predicate(c)) {
        cancelled.push(c);
        return false;
      }
      return true;
    });
    if (cancelled.length) {
      this.#emit({ type: "cancelled", commands: cancelled });
      this.#emit({ type: "change" });
    }
    return cancelled;
  }

  /** Resolves once nothing is queued or in flight. */
  idle() {
    if (!this.#running && this.#pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  #withWatchdog(promise) {
    let timer;
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Request did not settle"), { kind: "timeout" })), this.watchdogMs);
    });
    return Promise.race([promise, watchdog]).finally(() => clearTimeout(timer));
  }

  async #pump() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#pending.length) {
        const wait = this.#lastEnd + this.intervalMs - Date.now();
        if (wait > 0) await sleep(wait);
        const command = this.#pending.shift();
        if (!command) break; // everything was cancelled while waiting
        this.#inFlight = command;
        this.#emit({ type: "dispatch", command });
        try {
          await this.#withWatchdog(Promise.resolve().then(() => this.#send(command)));
          this.#emit({ type: "sent", command });
        } catch (error) {
          // Never retry: the device may already have acted on it.
          const cancelled = command.kind === "text"
            ? this.#takePending((c) => c.kind === "text")
            : [];
          this.#emit({ type: "failed", command, error, cancelled });
        } finally {
          this.#inFlight = null;
          this.#lastEnd = Date.now();
          this.#emit({ type: "change" });
        }
      }
    } finally {
      this.#running = false;
      const waiters = this.#idleWaiters.splice(0);
      waiters.forEach((resolve) => resolve());
      this.#emit({ type: "change" });
    }
  }

  #takePending(predicate) {
    const taken = this.#pending.filter(predicate);
    this.#pending = this.#pending.filter((c) => !predicate(c));
    return taken;
  }
}
