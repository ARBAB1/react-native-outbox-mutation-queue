import type { StorageAdapter } from './types';

/**
 * In-memory adapter. Used as the default so the queue works without
 * configuration, and useful in tests. Nothing survives a restart.
 */
export function createMemoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}
