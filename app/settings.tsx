import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { Button, Card, Hint, Label, SectionHead, Segmented, T } from '../src/components/ui';
import { useI18n } from '../src/i18n';
import { Lang } from '../src/i18n/strings';
import { ApiError, api } from '../src/lib/api';
import { AccountInfo, Provider, accountInfo, linkAccount, signInWith, signOut } from '../src/lib/auth';
import { confirm } from '../src/screens/kassa/useKassa';
import { SantaPromo } from '../src/components/SantaPromo';
import { Contacts } from '../src/components/Contacts';
import { remindersEnabled, setRemindersEnabled } from '../src/lib/reminders';
import { useTheme } from '../src/ThemeProvider';
import { ThemeMode } from '../src/theme';
import { C, F } from '../src/theme';

const LABEL: Record<Provider, string> = { apple: 'Apple', google: 'Google' };

export default function Settings() {
  const i = useI18n();
  const { t, lang, setLang } = i;
  const [acc, setAcc] = useState<AccountInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { mode, setMode } = useTheme();
  const [remind, setRemind] = useState(true);
  React.useEffect(() => {
    remindersEnabled().then(setRemind);
  }, []);

  const load = useCallback(() => {
    accountInfo().then(setAcc).catch(() => {});
  }, []);
  useFocusEffect(load);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'AUTH_CANCELLED')) Alert.alert(t('app.name'), i.errorText(e));
    } finally {
      setBusy(null);
      load();
    }
  };

  const save = (p: Provider) =>
    act(`save-${p}`, async () => {
      try {
        await linkAccount(p);
        Alert.alert(t('app.name'), t('account.saved', { provider: LABEL[p] }));
      } catch (e) {
        if (e instanceof ApiError && e.code === 'IDENTITY_TAKEN') {
          // Этот Apple / Google уже сохранён в другом аккаунте — предлагаем войти в него.
          if (await confirm(t('account.takenConfirm', { provider: LABEL[p] }), t('account.signIn'), t('common.cancel'))) {
            await signInWith(p);
            if (router.canDismiss()) router.dismissAll();
          }
          return;
        }
        throw e;
      }
    });

  const login = (p: Provider) =>
    act(`in-${p}`, async () => {
      if (!(await confirm(t('account.signInConfirm', { provider: LABEL[p] }), t('account.signIn'), t('common.cancel')))) return;
      await signInWith(p);
      if (router.canDismiss()) router.dismissAll();
    });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 22, paddingBottom: 48 }}>
      <Text style={{ color: C.fg, ...F.display, fontSize: 24 }}>{t('settings.title')}</Text>

      <Card tone={acc?.anonymous ? 'invite' : undefined}>
        <SectionHead title={t('account.title')} />
        {acc && !acc.anonymous ? (
          <>
            <T>{t('account.linked', { providers: acc.providers.map((p) => LABEL[p]).join(', ') })}</T>
            {acc.email ? <T muted style={{ fontSize: 13 }}>{acc.email}</T> : null}
            <Hint>{t('account.linkedHint')}</Hint>
            {(['apple', 'google'] as Provider[])
              .filter((p) => !acc.providers.includes(p))
              .map((p) => (
                <Button key={p} title={t('account.addProvider', { provider: LABEL[p] })} loading={busy === `save-${p}`} onPress={() => save(p)} />
              ))}
            <Button
              kind="danger"
              title={t('account.signOut')}
              loading={busy === 'out'}
              onPress={async () => {
                if (await confirm(t('account.signOutConfirm'), t('common.yes'), t('common.cancel'), true))
                  act('out', async () => {
                    await signOut();
                    if (router.canDismiss()) router.dismissAll();
                  });
              }}
            />
          </>
        ) : (
          <>
            <Hint>{t('account.anonHint')}</Hint>
            <Button kind="primary" title={t('account.saveWith', { provider: 'Apple' })} loading={busy === 'save-apple'} onPress={() => save('apple')} />
            <Button kind="primary" title={t('account.saveWith', { provider: 'Google' })} loading={busy === 'save-google'} onPress={() => save('google')} />
            <View style={{ gap: 8, marginTop: 6 }}>
              <Label>{t('account.haveAccount')}</Label>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button style={{ flex: 1 }} title="Apple" loading={busy === 'in-apple'} onPress={() => login('apple')} />
                <Button style={{ flex: 1 }} title="Google" loading={busy === 'in-google'} onPress={() => login('google')} />
              </View>
              <Hint>{t('account.signInHint')}</Hint>
            </View>
          </>
        )}
      </Card>

      <View style={{ gap: 8 }}>
        <Label>{t('settings.theme')}</Label>
        <Segmented<ThemeMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'system', label: t('settings.themeSystem') },
            { value: 'dark', label: t('settings.themeDark') },
            { value: 'light', label: t('settings.themeLight') },
          ]}
        />
      </View>

      <Pressable onPress={() => { setRemind(!remind); setRemindersEnabled(!remind); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: C.fg, ...F.bodySemi, fontSize: 15 }}>{t('settings.reminders')}</Text>
          <Hint>{t('settings.remindersHint')}</Hint>
        </View>
        <Switch
          value={remind}
          onValueChange={(v) => {
            setRemind(v);
            setRemindersEnabled(v);
          }}
          trackColor={{ true: C.accent, false: C.line }}
        />
      </Pressable>

      <View style={{ gap: 8 }}>
        <Label>{t('settings.language')}</Label>
        <Segmented<Lang>
          value={lang}
          onChange={setLang}
          options={[
            { value: 'kk', label: 'Қазақша' },
            { value: 'ru', label: 'Русский' },
            { value: 'en', label: 'English' },
          ]}
        />
      </View>

      <Contacts />

      <SantaPromo label={t('promo.more')} />

      <View style={{ gap: 8 }}>
        <Button
          kind="danger"
          loading={busy === 'delete'}
          title={t('settings.delete')}
          onPress={async () => {
            if (!(await confirm(t('settings.deleteConfirm'), t('common.yes'), t('common.cancel'), true))) return;
            act('delete', async () => {
              await api.deleteAccount();
              await signOut();
              if (router.canDismiss()) router.dismissAll();
            });
          }}
        />
        <Hint>{t('settings.deleteHint')}</Hint>
      </View>
    </ScrollView>
  );
}
