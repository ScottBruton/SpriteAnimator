import { Platform } from 'react-native';
import type { StorageAdapter } from './StorageAdapter';

let adapter: StorageAdapter | null = null;

/** Platform-specific storage adapter (IndexedDB on web, expo-file-system on native). */
export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  if (Platform.OS === 'web') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    adapter = (require('./webStorage') as typeof import('./webStorage')).webStorage;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    adapter = (require('./nativeStorage') as typeof import('./nativeStorage')).nativeStorage;
  }
  return adapter;
}

export { SETTING_LAST_PROJECT } from './StorageAdapter';
export type { StorageAdapter } from './StorageAdapter';
