import React, { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '@/theme/tokens';

const Screen = React.lazy(() => import('@/components/runtimeTest/RuntimeTestScreen').then((m) => ({ default: m.RuntimeTestScreen })));

/**
 * Standalone runtime verification: loads an exported ZIP / assembly.json with only the
 * `@elemental/animation-runtime` package — no editor state is involved.
 */
export default function RuntimeTestRoute() {
  return (
    <Suspense fallback={<View style={{ flex: 1, backgroundColor: colors.bg0, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.accent} /></View>}>
      <Screen />
    </Suspense>
  );
}
