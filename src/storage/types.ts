/**
 * Minimal persistence contract.
 *
 * Deliberately shaped like AsyncStorage so `@react-native-async-storage/
 * async-storage` can be passed straight in, while MMKV, SQLite or a test
 * double can be adapted in a few lines.
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
