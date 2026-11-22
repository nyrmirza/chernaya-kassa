import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, ErrorText, T } from '../src/components/ui';
import { I18nProvider, useI18n } from '../src/i18n';
import * as Notifications from 'expo-notifications';
import { setupNotifications } from '../src/lib/reminders';
import { ensureSession } from '../src/lib/supabase';
import { ThemeProvider, useTheme } from '../src/ThemeProvider';
import { C, F } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
setupNotifications();

function Gate({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const start = () => {
    setFailed(false);
    ensureSession()
      .then(() => setReady(true))
      .catch(() => setFailed(true))
      .finally(() => SplashScreen.hideAsync().catch(() => {}));
  };
  useEffect(start, []);

  // Нажали на уведомление (напоминание или push) — открыть эту кассу.
  useEffect(() => {
    if (!ready) return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const kassa = r?.notification.request.content.data?.kassa;
      if (typeof kassa === 'string') router.push(`/kassa/${kassa}`);
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [ready]);

  if (failed)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 24, gap: 16 }}>
        <T style={{ ...F.display, fontSize: 22 }}>{t('app.name')}</T>
        <ErrorText text={t('err.NETWORK')} />
        <Button kind="primary" title={t('common.retry')} onPress={start} />
      </View>
    );
  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg }} />;
  return <>{children}</>;
}

/** Кнопка «Закрыть» в шапке модальных окон (окно также закрывается свайпом вниз). */
function CloseButton() {
  const { t } = useI18n();
  return (
    <Pressable accessibilityRole="button" hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
      <Text style={{ color: C.accent, ...F.bodyBold, fontSize: 16 }}>{t('common.close')}</Text>
    </Pressable>
  );
}

function AppStack() {
  const { scheme } = useTheme();
  const modal = { presentation: 'modal' as const, title: '', headerRight: () => <CloseButton /> };
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Gate>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.accent,
            headerTitleStyle: { color: C.fg, ...F.bodyBold },
            headerShadowVisible: false,
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: C.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="create" options={modal} />
          <Stack.Screen name="join/index" options={modal} />
          <Stack.Screen name="join/[code]" options={{ title: '' }} />
          <Stack.Screen name="kassa/[id]" options={{ title: '' }} />
          <Stack.Screen name="p/[token]" options={{ title: '' }} />
          <Stack.Screen name="j/[code]" options={{ headerShown: false }} />
          <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={modal} />
        </Stack>
      </Gate>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <ThemeProvider>
          <AppStack />
        </ThemeProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
