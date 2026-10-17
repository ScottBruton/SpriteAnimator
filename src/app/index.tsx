import React, { Suspense, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, font } from '@/theme/tokens';

// Lazy so that the Skia-dependent editor bundle only evaluates after CanvasKit is ready (web).
const Editor = React.lazy(() => import('@/components/shell/EditorShell').then((m) => ({ default: m.EditorShell })));

export default function EditorScreen() {
  const insets = useSafeAreaInsets();
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { restoreLastSession } = await import('@/storage/projectService');
        const { installModifierTracking } = await import('@/rendering/modifiers');
        installModifierTracking();
        await restoreLastSession();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!booted) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.hint}>Opening project…</Text>
      </View>
    );
  }
  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {error ? <Text style={styles.error}>Session restore failed: {error} — starting with a new project.</Text> : null}
      <Suspense
        fallback={
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
          </View>
        }
      >
        <Editor />
      </Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.bg0 },
  hint: { color: colors.textMuted, fontSize: font.md },
  error: { color: colors.warning, fontSize: font.sm, padding: 6 },
});
