import { useMemo } from 'react';
import { evaluatePose, type EvaluatedPose, type PlayingLayer } from '@elemental/animation-core';
import { useEditorStore } from '@/state/editorStore';
import { usePoseOverrideStore } from '@/state/poseOverrideStore';
import { useActiveAssembly, useAssetLookup } from '@/state/projectStore';

/**
 * Pose shown on the editor canvas. Rigging = setup pose; Animate = active action at the playhead
 * plus any un-keyed edits. Uses the exact same evaluator as the exported runtime.
 */
export function useEvaluatedPose(): EvaluatedPose | null {
  const assembly = useActiveAssembly();
  const lookup = useAssetLookup();
  const workspace = useEditorStore((s) => s.workspace);
  const activeActionId = useEditorStore((s) => s.activeActionId);
  const playhead = useEditorStore((s) => s.playhead);
  const direction = useEditorStore((s) => s.direction);
  const overrides = usePoseOverrideStore((s) => s.overrides);

  return useMemo(() => {
    if (!assembly) return null;
    const layers: PlayingLayer[] = [];
    const animating = workspace === 'animate' && !!activeActionId && assembly.actions.some((a) => a.id === activeActionId);
    if (animating) layers.push({ actionId: activeActionId!, time: playhead });
    return evaluatePose({
      assembly,
      direction,
      layers,
      lookupAsset: lookup,
      applyAnimation: animating,
      overrides: animating ? overrides : undefined,
    });
  }, [assembly, workspace, activeActionId, playhead, direction, lookup, overrides]);
}

export function isAnimateMode(): boolean {
  const s = useEditorStore.getState();
  return s.workspace === 'animate' && !!s.activeActionId;
}
