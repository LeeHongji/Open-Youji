export class ConversationLock {
  private locks = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, promise);
    return () => {
      this.locks.delete(key);
      release();
    };
  }
}
