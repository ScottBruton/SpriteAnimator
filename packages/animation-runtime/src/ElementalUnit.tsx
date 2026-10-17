import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas } from '@shopify/react-native-skia';
import type { AssemblyPackage, AudioEvent, Direction, SpriteAsset } from '@elemental/asset-schema';
import { BASE_CHANNEL_ID } from '@elemental/asset-schema';
import { ImageRegistry, sharedImageRegistry } from './ImageRegistry';
import { useAssemblyImages, useImageRegistry, useUnit } from './hooks';
import { RenderListView } from './render/RenderListView';

export interface ElementalUnitProps {
  assembly: AssemblyPackage;
  /** Maps a package-relative image path to a URI (or PNG bytes). */
  resolveImage: (asset: SpriteAsset) => string | Uint8Array | undefined;
  direction?: Direction;
  /** Action id or action name. */
  action?: string;
  channelId?: string;
  playing?: boolean;
  speed?: number;
  scale?: number;
  /** Position of the unit origin inside the canvas (pixels). Defaults to the centre. */
  position?: { x: number; y: number };
  visible?: boolean;
  /** Canvas size. */
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
  registry?: ImageRegistry;
  onActionComplete?: (channelId: string, actionId: string) => void;
  onAudioEvent?: (event: AudioEvent) => void;
  onActionLoop?: (channelId: string, actionId: string) => void;
}

/**
 * Drop-in React Native component that renders one unit from an exported assembly package.
 * Rendering uses the same evaluator as the editor (`@elemental/animation-core`).
 */
export function ElementalUnit(props: ElementalUnitProps) {
  const {
    assembly,
    resolveImage,
    direction,
    action,
    channelId,
    playing = true,
    speed = 1,
    scale = 1,
    width = 256,
    height = 256,
    visible = true,
    style,
  } = props;
  const registry = useImageRegistry(props.registry ?? sharedImageRegistry);
  useAssemblyImages(assembly, resolveImage, registry);
  const { unit, frame } = useUnit(assembly, { direction, playing, speed });
  const [, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!unit) return;
    unit.events = {
      onActionComplete: props.onActionComplete,
      onAudioEvent: props.onAudioEvent ? (ev) => props.onAudioEvent?.(ev) : undefined,
      onActionLoop: props.onActionLoop,
    };
  }, [unit, props.onActionComplete, props.onAudioEvent, props.onActionLoop]);

  useEffect(() => {
    if (!unit || !action) return;
    const byId = assembly.assembly.actions.find((a) => a.id === action || a.name === action);
    if (!byId) {
      setErr(`Unknown action ${action}`);
      return;
    }
    unit.play(byId.id, { channelId: channelId ?? byId.channelId ?? BASE_CHANNEL_ID });
  }, [unit, action, channelId, assembly]);

  const imagePathForAsset = useMemo(() => {
    const map = new Map(assembly.assets.map((a) => [a.id, a.imagePath] as const));
    return (id: string) => map.get(id);
  }, [assembly]);

  const pose = unit ? unit.evaluate() : null;
  const origin = props.position ?? { x: width / 2, y: height / 2 };
  const matrix = [scale, 0, origin.x, 0, scale, origin.y, 0, 0, 1];
  void frame;

  if (!visible) return null;
  return (
    <View style={[{ width, height }, styles.container, style]}>
      <Canvas style={{ width, height }}>
        {pose && (
          <RenderListView renderList={pose.renderList} images={registry} imagePathForAsset={imagePathForAsset} matrix={matrix} />
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ container: { overflow: 'hidden' } });
