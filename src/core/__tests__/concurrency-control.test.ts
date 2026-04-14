import { describe, it, expect } from "vitest";
import { RunQueue } from "../concurrency-control.js";

describe("RunQueue", () => {
  it("should allow up to maxConcurrent tasks to run immediately", async () => {
    const queue = new RunQueue(2);

    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
    };

    await Promise.all([queue.run(task), queue.run(task)]);

    expect(maxRunning).toBe(2);
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it("should queue tasks when maxConcurrent is reached", async () => {
    const queue = new RunQueue(2);

    let running = 0;
    let maxRunning = 0;
    let completed = 0;

    const task = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      running--;
      completed++;
    };

    const p1 = queue.run(task);
    const p2 = queue.run(task);
    const p3 = queue.run(task);
    const p4 = queue.run(task);

    expect(queue.runningCount).toBe(2);
    expect(queue.pendingCount).toBe(2);

    await Promise.all([p1, p2, p3, p4]);

    expect(maxRunning).toBe(2);
    expect(completed).toBe(4);
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  it("should handle errors in tasks and release slots", async () => {
    const queue = new RunQueue(1);

    const failingTask = async () => {
      await Promise.resolve();
      throw new Error("Task failed");
    };

    const succeedingTask = async () => {
      await Promise.resolve();
      return "success";
    };

    await expect(queue.run(failingTask)).rejects.toThrow("Task failed");

    // The slot should be released, so the next task can run
    const result = await queue.run(succeedingTask);
    expect(result).toBe("success");
    expect(queue.runningCount).toBe(0);
  });

  it("should allow manual acquire and release", async () => {
    const queue = new RunQueue(1);

    const release1 = await queue.acquire();
    expect(queue.runningCount).toBe(1);

    let acquired2 = false;
    void queue.acquire().then((release: () => void) => {
      acquired2 = true;
      release();
    });

    // Wait a tick to ensure the promise had a chance to resolve if it was going to
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acquired2).toBe(false);

    release1();

    // Wait a tick to allow the queued acquire to resolve
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(acquired2).toBe(true);
    expect(queue.runningCount).toBe(0);
  });

  it("should ignore multiple calls to release", async () => {
    const queue = new RunQueue(1);

    const release1 = await queue.acquire();
    release1();
    release1(); // Should not decrement runningCount below 0

    expect(queue.runningCount).toBe(0);
  });
});
