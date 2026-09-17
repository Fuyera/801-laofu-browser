export interface RateEvidence {
  origin: string;
  retryAfter: string | null;
  observedAt: number;
  jobId: string;
  fence: number;
}
type Sample = Omit<RateEvidence, "jobId" | "fence">;
/** Correlate request-start generations and exact Page identities, never URL guesses. */
export class RateLimitScope<P extends object, R extends object> {
  private generation = 0;
  private current?: { jobId: string; fence: number; active: boolean; pages: Set<P> };
  private requests = new WeakMap<R, { generation: number; page?: P }>();
  private pending: Array<{ page: P; sample: Sample; generation: number }> = [];
  constructor(private readonly notify: (evidence: RateEvidence) => void) {}
  control(jobId: string, fence: number, cancelled = false) {
    const same = this.current?.jobId === jobId && this.current.fence === fence;
    if (!same || cancelled || !this.current?.active) {
      this.generation++;
      this.pending = [];
      this.current = { jobId, fence, active: !cancelled, pages: same ? this.current!.pages : new Set() };
    }
  }
  bind(page: P, jobId: string, fence: number, newlyCreated = false) {
    const current = this.current;
    if (!current?.active || current.jobId !== jobId || current.fence !== fence) return;
    current.pages.add(page);
    const pending = this.pending;
    this.pending = pending.filter((p) => p.page !== page);
    // Only a newly created, subsequently identity-verified tab may adopt initial
    // navigation responses. Never retroactively adopt an old tab's background traffic.
    if (newlyCreated) for (const item of pending) {
      if (item.page === page && item.generation === this.generation && current.active)
        this.notify({ ...item.sample, jobId, fence });
    }
  }
  request(request: R, page?: P) {
    if (this.current?.active) this.requests.set(request, { generation: this.generation, page });
  }
  response(request: R, sample: Sample, resolvedPage?: P): boolean {
    const started = this.requests.get(request), current = this.current;
    const page = started?.page || resolvedPage;
    if (!started || !page || !current?.active || started.generation !== this.generation) return false;
    if (current.pages.has(page)) {
      this.notify({ ...sample, jobId: current.jobId, fence: current.fence });
      return true;
    }
    // Bounded retention for a tab-creation operation whose tabId arrives after headers.
    this.pending.push({ page, sample, generation: this.generation });
    if (this.pending.length > 128) this.pending.shift();
    return false;
  }
  clear() {
    this.generation++;
    this.current = undefined;
    this.pending = [];
    this.requests = new WeakMap();
  }
}
