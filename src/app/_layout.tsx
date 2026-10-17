import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import { colors, font } from '@/theme/tokens';

/**
 * Root layout. On web, Skia's CanvasKit WASM must be loaded before any `@shopify/react-native-skia`
 * import executes, so screens are only mounted after `LoadSkiaWeb()` resolves. Screens import Skia
 * lazily (see `index.tsx`).
 */
export default function RootLayout() {
  const [ready, setReady] = useState(Platform.OS !== 'web');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let cancelled = false;
    (async () => {
      try {
        const { LoadSkiaWeb } = await import('@shopify/react-native-skia/lib/module/web');
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });
        if (!cancelled) setReady(true);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {error ? (
          <View style={styles.centre}>
            <Text style={styles.error}>Failed to load the Skia renderer: {error}</Text>
            <Text style={styles.hint}>Ensure `public/canvaskit.wasm` exists (run `npm install` to copy it) and reload.</Text>
          </View>
        ) : !ready ? (
          <View style={styles.centre}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.hint}>Loading renderer…</Text>
          </View>
        ) : (
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg0 } }} />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg0 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.bg0 },
  hint: { color: colors.textMuted, fontSize: font.md },
  error: { color: colors.danger, fontSize: font.lg, paddingHorizontal: 24, textAlign: 'center' },
});
