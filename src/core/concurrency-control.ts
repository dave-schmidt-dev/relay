export class RunQueue {
  private maxConcurrent: number;
  private currentRunning = 0;
  private queue: (() => void)[] = [];

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Enqueues a task and returns a promise that resolves when the task is allowed to run.
   * The caller MUST call the returned `release` function when the task is complete.
   */
  async acquire(): Promise<() => void> {
    if (this.currentRunning < this.maxConcurrent) {
      this.currentRunning++;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        resolve(this.createRelease());
      });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.currentRunning--;
      this.processQueue();
    };
  }

  private processQueue() {
    if (this.queue.length > 0 && this.currentRunning < this.maxConcurrent) {
      this.currentRunning++;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  /**
   * Helper to run a task with concurrency control.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.currentRunning;
  }
}
