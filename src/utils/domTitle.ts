import type { Ref } from 'react';
import { Platform } from 'react-native';

/**
 * React Native Web's createDOMProps does not forward the HTML `title` attribute,
 * so native browser tooltips never appear if you only pass `title={...}` to Pressable/View.
 * Call this from a ref callback to set the attribute on the real DOM node.
 */
export function applyDomTitle(node: unknown, title: string | undefined): void {
  if (Platform.OS !== 'web' || !node || typeof node !== 'object') return;
  const el = node as { setAttribute?: (k: string, v: string) => void; removeAttribute?: (k: string) => void };
  if (typeof el.setAttribute !== 'function') return;
  if (title) el.setAttribute('title', title);
  else el.removeAttribute?.('title');
}

/** Merge a forwarded ref with DOM-title application. */
export function mergeTitleRef<T>(title: string | undefined, forwarded?: Ref<T>): (node: T | null) => void {
  return (node) => {
    applyDomTitle(node, title);
    if (!forwarded) return;
    if (typeof forwarded === 'function') forwarded(node);
    else (forwarded as { current: T | null }).current = node;
  };
}
