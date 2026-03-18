import { describe, it, expect } from "vitest";
import { ConversationLock } from "./thread-mutex.js";

describe("ConversationLock", () => {
  it("acquire and release works sequentially", async () => {
    const lock = new ConversationLock();
    const release = await lock.acquire("key1");
    release();
    // Should not throw or deadlock
  });

  it("second acquire on same key blocks until first releases", async () => {
    const lock = new ConversationLock();
    const order: number[] = [];

    const release1 = await lock.acquire("key1");
    order.push(1);

    const p2 = lock.acquire("key1").then((release) => {
      order.push(2);
      release();
    });

    // Give p2 a tick to attempt acquire (it should be blocked)
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1]); // p2 should still be waiting

    release1();
    await p2;
    expect(order).toEqual([1, 2]);
  });

  it("different keys are independent (no cross-blocking)", async () => {
    const lock = new ConversationLock();
    const order: string[] = [];

    const releaseA = await lock.acquire("keyA");
    order.push("A-acquired");

    const releaseB = await lock.acquire("keyB");
    order.push("B-acquired");

    // Both acquired without blocking
    expect(order).toEqual(["A-acquired", "B-acquired"]);

    releaseA();
    releaseB();
  });

  it("release and re-acquire on same key works (no deadlock)", async () => {
    const lock = new ConversationLock();

    const release1 = await lock.acquire("key1");
    release1();

    const release2 = await lock.acquire("key1");
    release2();

    const release3 = await lock.acquire("key1");
    release3();
    // Should complete without hanging
  });

  it("three concurrent acquires on same key serialize in order", async () => {
    const lock = new ConversationLock();
    const order: number[] = [];

    const release1 = await lock.acquire("key1");

    const p2 = lock.acquire("key1").then((release) => {
      order.push(2);
      release();
    });

    const p3 = lock.acquire("key1").then((release) => {
      order.push(3);
      release();
    });

    order.push(1);
    release1();

    await Promise.all([p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });
});
