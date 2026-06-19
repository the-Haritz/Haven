import { describe, it, expect } from 'vitest';
import { Mutex } from './mutex';

describe('Mutex', () => {
  it('should acquire and release the lock successfully', async () => {
    const mutex = new Mutex();
    const unlock = await mutex.lock();
    expect(typeof unlock).toBe('function');
    unlock();
  });

  it('should serialize concurrent operations', async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    // Helper to simulate an async task under lock
    const runTask = async (id: number, delayMs: number) => {
      const unlock = await mutex.lock();
      try {
        order.push(id * 10); // Start of task
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(id * 10 + 1); // End of task
      } finally {
        unlock();
      }
    };

    // Run three tasks concurrently. Due to mutex, they should run sequentially:
    // task 1 start, task 1 end, task 2 start, task 2 end, task 3 start, task 3 end
    await Promise.all([
      runTask(1, 50),
      runTask(2, 30),
      runTask(3, 10),
    ]);

    expect(order).toEqual([10, 11, 20, 21, 30, 31]);
  });
});
