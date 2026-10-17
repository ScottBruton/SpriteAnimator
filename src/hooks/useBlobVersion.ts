import { useEffect, useReducer } from 'react';
import { blobStore } from '@/state/blobStore';

/** Re-render when binary blobs are added/removed (thumbnails, image availability). */
export function useBlobVersion(): number {
  const [v, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => blobStore.subscribe(bump), []);
  return v;
}
