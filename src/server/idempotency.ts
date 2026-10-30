/**
 * Idempotency Management for Backend Mutation Requests (EOS-004)
 */

export interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  createdAt: number;
}

export class IdempotencyStore {
  private cache: Map<string, CachedResponse> = new Map();
  private readonly ttlMs: number;

  constructor(ttlMs: number = 24 * 60 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  get(key: string): CachedResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, statusCode: number, body: any, headers: Record<string, string> = {}): void {
    this.cache.set(key, {
      statusCode,
      headers,
      body,
      createdAt: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

export const defaultIdempotencyStore = new IdempotencyStore();
