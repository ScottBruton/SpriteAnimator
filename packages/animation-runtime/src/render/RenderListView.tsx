import React from 'react';
import { Group, Image } from '@shopify/react-native-skia';
import { toSkiaMatrixValues, type RenderItem } from '@elemental/animation-core';
import type { ImageRegistry } from '../ImageRegistry';
import type { ImagePathLookup } from './drawRenderList';

export interface RenderListViewProps {
  renderList: readonly RenderItem[];
  images: ImageRegistry;
  imagePathForAsset: ImagePathLookup;
  /** Optional matrix applied to the whole list (world → canvas). */
  matrix?: number[];
  /** Draw a placeholder rectangle for items whose image is not loaded. */
  placeholderColor?: string;
}

/**
 * Declarative Skia renderer for a render list. Each item is drawn as the original PNG under its
 * image-local → world matrix; nothing is pre-rendered.
 */
export function RenderListView({ renderList, images, imagePathForAsset, matrix, placeholderColor }: RenderListViewProps) {
  return (
    <Group matrix={matrix}>
      {renderList.map((item) => {
        const key = imagePathForAsset(item.assetId);
        const img = key ? images.get(key) : undefined;
        const m = toSkiaMatrixValues(item.matrix);
        if (!img) {
          if (!placeholderColor) return null;
          return (
            <Group key={item.instanceId} matrix={m} opacity={item.opacity}>
              <Image image={null} x={0} y={0} width={item.width} height={item.height} />
            </Group>
          );
        }
        return (
          <Group key={item.instanceId} matrix={m} opacity={item.opacity}>
            <Image image={img} x={0} y={0} width={item.width} height={item.height} fit="fill" />
          </Group>
        );
      })}
    </Group>
  );
}
