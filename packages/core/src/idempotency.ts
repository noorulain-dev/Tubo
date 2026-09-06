/**
 * Idempotency key -> external ref mapping, used to guarantee a write is applied
 * at most once even when an executor retries.
 */
export interface IdempotencyStore {
  get(key: string): string | undefined;
  set(key: string, externalRef: string): void;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly map = new Map<string, string>();
  get(key: string): string | undefined {
    return this.map.get(key);
  }
  set(key: string, externalRef: string): void {
    this.map.set(key, externalRef);
  }
}
