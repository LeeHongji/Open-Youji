/** Push queue for serializing git pushes from concurrent fleet/opus sessions (ADR 0061). */

export interface PushRequest {
  sessionId: string;
  cwd: string;
  priority: "opus" | "fleet";
  enqueuedAt: number;
}

export interface PushResult {
  sessionId: string;
  status: "pushed" | "branch-fallback" | "error" | "nothing-to-push";
  branch?: string;
  error?: string;
  waitMs: number;
  queueDepth: number;
}

const DEFAULT_RESULT_TTL_MS = 300_000; // 5 minutes

export class PushQueue {
  private queue: PushRequest[] = [];
  private processing = false;
  private processingSessionId: string | null = null;
  private results = new Map<string, PushResult>();
  private resultTtlMs: number;

  constructor(options?: { resultTtlMs?: number }) {
    this.resultTtlMs = options?.resultTtlMs ?? DEFAULT_RESULT_TTL_MS;
  }

  /**
   * Add a push request to the queue.
   * Returns the position in the queue (1-indexed).
   */
  enqueue(req: Omit<PushRequest, "enqueuedAt">): { position: number } {
    const fullReq: PushRequest = {
      ...req,
      enqueuedAt: Date.now(),
    };
    this.queue.push(fullReq);
    this.sortQueue();
    return { position: this.queue.length };
  }

  /**
   * Get the result of a push operation.
   * Returns null if the push hasn't completed or the result has expired.
   */
  getResult(sessionId: string): PushResult | null {
    return this.results.get(sessionId) ?? null;
  }

  /**
   * Get the current queue depth.
   */
  getQueueDepth(): number {
    return this.queue.length;
  }

  /**
   * Check if the queue is currently processing a push.
   */
  isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Get the session ID currently being processed, or null if idle.
   * Used by the status endpoint to identify requests that have been dequeued
   * but whose results haven't been stored yet.
   */
  getProcessingSessionId(): string | null {
    return this.processingSessionId;
  }

  /**
   * Get a snapshot of the current queue for debugging/monitoring.
   */
  getQueueSnapshot(): PushRequest[] {
    return [...this.queue];
  }

  /**
   * Process all queued pushes sequentially.
   * This method should be called by the scheduler to drain the queue.
   */
  async processQueue(
    executePushFn: (req: PushRequest) => Promise<PushResult>,
  ): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const req = this.queue.shift()!;
        this.processingSessionId = req.sessionId;
        const queueDepth = this.queue.length;
        const startMs = Date.now();

        const result = await executePushFn(req);
        const waitMs = Date.now() - startMs;

        const fullResult: PushResult = {
          ...result,
          sessionId: req.sessionId,
          waitMs,
          queueDepth,
        };

        this.results.set(req.sessionId, fullResult);
        this.processingSessionId = null;
        this.scheduleResultCleanup(req.sessionId);
      }
    } finally {
      this.processing = false;
      this.processingSessionId = null;
    }
  }

  /**
   * Clear all queued requests (for testing/shutdown).
   */
  clearQueue(): void {
    this.queue = [];
  }

  /**
   * Clear all stored results (for testing).
   */
  clearResults(): void {
    this.results.clear();
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority === "opus" ? -1 : 1;
      }
      return a.enqueuedAt - b.enqueuedAt;
    });
  }

  private scheduleResultCleanup(sessionId: string): void {
    setTimeout(() => {
      this.results.delete(sessionId);
    }, this.resultTtlMs);
  }
}
