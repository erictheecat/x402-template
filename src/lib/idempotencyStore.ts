import { LRUCache } from "lru-cache";

export interface IdempotencyEntry {
  key: string;
  createdAt: number;
}

export class IdempotencyStore {
  private readonly cache: LRUCache<string, IdempotencyEntry>;

  constructor(ttlMs = 10 * 60 * 1000, max = 10_000) {
    this.cache = new LRUCache<string, IdempotencyEntry>({
      ttl: ttlMs,
      max,
    });
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  markSeen(key: string): void {
    this.cache.set(key, {
      key,
      createdAt: Date.now(),
    });
  }
}
