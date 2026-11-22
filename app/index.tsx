import { router, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar, Button, ErrorText, Hint, Pill, Row, SectionHead, T, Card } from '../src/components/ui';
import { useI18n } from '../src/i18n';
import { KassaListItem, api } from '../src/lib/api';
import { accountInfo } from '../src/lib/auth';
import { startDemo, syncDemoLang } from '../src/lib/demo';
import { registerPush } from '../src/lib/push';
import { pruneReminders } from '../src/lib/reminders';
import { SantaPromo } from '../src/components/SantaPromo';
import { Lang } from '../src/i18n/strings';

const LANG_LABEL: Record<Lang, string> = { kk: 'Қазақша', ru: 'Русский', en: 'English' };
import { C, F, onTheme } from '../src/theme';

export default function Home() {
  const i = useI18n();
  const { t } = i;
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<KassaListItem[] | null>(null);
  const [reclaims, setReclaims] = useState<{ id: string; kassa_title: string; seat_name: string }[]>([]);
  const [anon, setAnon] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, rec, acc] = await Promise.all([api.myKassas(), api.myReclaims(), accountInfo()]);
      setItems(list);
      // Убрать напоминания удалённых/пересозданных касс и демо.
      pruneReminders(list.map((k) => k.id));
      // Есть хоть одна касса — подключаем push (спросит разрешение один раз).
      if (list.length) registerPush(i.lang);
      setReclaims(rec);
      setAnon(acc.anonymous);
      setErr(null);
    } catch (e) {
      setErr(i.errorText(e));
    }
  }, [i]);

  // Демо-касса следует за языком приложения.
  const lastLang = useRef(i.lang);
  useEffect(() => {
    if (lastLang.current === i.lang || !items) return;
    lastLang.current = i.lang;
    syncDemoLang(i.lang, items.map((k) => k.id)).then((changed) => { if (changed) load(); });
  }, [i.lang, items, load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={[st.wrap, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
      refreshControl={<RefreshControl tintColor={C.accent} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <View style={st.top}>
        <Text style={st.brand}>{t('app.name')}</Text>
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings')} hitSlop={12}>
          <Text style={{ color: C.muted, ...F.bodySemi }}>{t('home.settings')}</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(['kk', 'ru', 'en'] as Lang[]).map((l) => {
          const on = l === i.lang;
          return (
            <Pressable
              key={l}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => i.setLang(l)}
              hitSlop={6}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? C.accent : C.line, backgroundColor: on ? C.accent : 'transparent' }}
            >
              <Text style={{ color: on ? C.accentInk : C.muted, ...F.bodySemi, fontSize: 13 }}>{LANG_LABEL[l]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 10 }}>
        <Text style={st.h1}>{t('home.tagline')}</Text>
        <Hint>{t('home.sub')}</Hint>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button kind="primary" style={{ flex: 1 }} title={t('home.create')} onPress={() => router.push('/create')} />
        <Button style={{ flex: 1 }} title={t('home.join')} onPress={() => router.push('/join')} />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          try {
            const id = await startDemo(i.lang);
            router.push(`/kassa/${id}`);
          } catch (e) {
            setErr(i.errorText(e));
          }
        }}
      >
        <Text style={{ color: C.accent, ...F.bodyBold, textAlign: 'center' }}>{t('demo.button')}</Text>
      </Pressable>

      {anon && items ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings')}>
          <Card tone="invite">
            <T style={{ ...F.bodyBold }}>{items.length ? t('account.bannerSave') : t('account.bannerHave')}</T>
            <T muted style={{ fontSize: 13 }}>{items.length ? t('account.bannerSaveSub') : t('account.bannerHaveSub')}</T>
          </Card>
        </Pressable>
      ) : null}

      {reclaims.map((r) => (
        <Card key={r.id}>
          <T style={{ ...F.bodySemi }}>{t('reclaim.waiting', { title: r.kassa_title, seat: r.seat_name })}</T>
          <Button title={t('queue.cancelSwap')} onPress={async () => { await api.cancelReclaim(r.id).catch(() => {}); load(); }} />
        </Card>
      ))}

      <View style={{ gap: 4 }}>
        <SectionHead title={t('home.my')} />
        <ErrorText text={err} />
        {items && items.length === 0 ? <Hint>{t('home.empty')}</Hint> : null}
        {items?.map((k, idx) => {
          const sub =
            k.status === 'open'
              ? k.target_size
                ? t('plate.joined', { a: k.seats, b: k.target_size })
                : t('home.statusOpen')
              : k.status === 'finished'
                ? t('home.statusFinished')
                : k.current_month
                  ? t('home.now', { month: i.monthName(k.current_month), name: k.current_holder ?? '—' })
                  : '';
          return (
            <Pressable key={k.id} accessibilityRole="button" onPress={() => router.push(`/kassa/${k.id}`)}>
              <Row last={idx === items.length - 1}>
                <Avatar name="₸" />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T numberOfLines={1} style={{ ...F.bodySemi }}>{k.title}</T>
                  <T muted numberOfLines={1} style={{ fontSize: 13 }}>
                    {sub} · {t('home.seats', { n: k.seats })}
                  </T>
                </View>
                {k.pending_swaps > 0 ? <Pill tone="now" text={t('queue.swapTitle')} /> : null}
                {k.pending_reclaims > 0 ? <Pill tone="now" text={t('reclaim.badge')} /> : null}
                {k.is_owner ? <Pill tone="admin" text={t('home.organizer')} /> : null}
              </Row>
            </Pressable>
          );
        })}
      </View>

      <SantaPromo canHide />
    </ScrollView>
  );
}

const build_st = () =>
  StyleSheet.create({
  wrap: { paddingHorizontal: 16, gap: 22 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { color: C.fg, ...F.display, fontSize: 16, letterSpacing: 0.6, textTransform: 'uppercase' },
  h1: { color: C.fg, ...F.display, fontSize: 32, lineHeight: 36, textTransform: 'uppercase' },
});

let st = build_st();
onTheme(() => {
  st = build_st();
});
