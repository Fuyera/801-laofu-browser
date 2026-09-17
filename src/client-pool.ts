/** Bounded, reference-counted clients. Browser/session data is not owned here. */
export interface ClosableClient {
  close(): Promise<void>;
}
interface Entry<T> {
  key: string;
  ready: Promise<T>;
  users: number;
  idleSince: number;
  retired: boolean;
  disposing: boolean;
  drained: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}
export class ClientPool<T extends ClosableClient> {
  private entries = new Map<string, Entry<T>>();
  private stopped = false;
  constructor(
    private readonly create: (key: string) => Promise<T>,
    private readonly maxClients = 16,
    private readonly idleMs = 300_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(maxClients) || maxClients < 1 || idleMs < 0)
      throw new Error("Invalid client pool limits");
  }
  get size() { return this.entries.size; }

  async use<R>(key: string, operation: (client: T) => Promise<R>): Promise<R> {
    if (this.stopped) throw new Error("Client pool stopped");
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= this.maxClients) {
        const idle = [...this.entries.values()]
          .filter((e) => e.users === 0 && !e.retired)
          .sort((a, b) => a.idleSince - b.idleSince)[0];
        if (!idle) throw new Error("Client pool capacity reached");
        await this.release(idle.key);
        // Recheck after awaiting: another caller may have claimed this key/slot.
        return this.use(key, operation);
      }
      let resolve!: () => void, reject!: (error: unknown) => void;
      const drained = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
      // A task may retire its entry without awaiting it until its call completes.
      void drained.catch(() => {});
      entry = {
        key, users: 0, idleSince: this.now(), retired: false, disposing: false,
        ready: Promise.resolve().then(() => this.create(key)),
        drained, resolve, reject,
      };
      this.entries.set(key, entry);
    }
    if (entry.retired) throw new Error("Client session is closing");
    entry.users++;
    let connected = false;
    try {
      const client = await entry.ready;
      connected = true;
      if (this.stopped) throw new Error("Client pool stopped");
      return await operation(client);
    } catch (error) {
      // The factory must close any transport it created before rejecting.
      if (!connected) entry.retired = true;
      throw error;
    } finally {
      entry.users--;
      entry.idleSince = this.now();
      if (entry.retired) this.dispose(entry);
    }
  }

  release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve();
    entry.retired = true;
    this.dispose(entry);
    return entry.drained;
  }
  async sweep(): Promise<void> {
    const now = this.now();
    await Promise.all([...this.entries.values()]
      .filter((e) => e.users === 0 && !e.retired && now - e.idleSince >= this.idleMs)
      .map((e) => this.release(e.key)));
  }
  async close(): Promise<void> {
    this.stopped = true;
    const entries = [...this.entries.values()];
    for (const entry of entries) {
      entry.retired = true;
      // Shutdown must interrupt live calls, unlike idle/session retirement.
      this.dispose(entry, true);
    }
    await Promise.all(entries.map((e) => e.drained));
  }
  private dispose(entry: Entry<T>, force = false) {
    if (entry.disposing || (!force && entry.users > 0)) return;
    entry.disposing = true;
    void entry.ready.then((client) => client.close(), () => {}).then(() => {
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      entry.resolve();
    }, (error) => {
      // Keep a failed-close slot reserved; do not grow unchecked after cleanup failure.
      entry.reject(error);
    });
  }
}
