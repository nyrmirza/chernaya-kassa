import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { useI18n } from '../i18n';
import { C, F } from '../theme';
import { Button, Card, Label, T } from './ui';

/**
 * Реклама нашего приложения «Тайный Санта».
 * App Store: Santa Draw (id6827447523). Google Play — по пакету, заработает после публикации.
 */
export const SANTA_APP_STORE = 'https://apps.apple.com/app/id6827447523';
export const SANTA_GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=kz.nurbakyt.secretsanta';

const HIDE_KEY = 'kassa.promo.santa.hidden';
const SANTA_IOS_ID = '6827447523';
/** Поставьте true, когда Santa Draw выйдет в Google Play. */
const SANTA_ON_GOOGLE_PLAY = true;

/**
 * Карточку показываем, только если Santa Draw реально доступна в магазине —
 * иначе кнопка вела бы на «приложение недоступно» (Apple отклоняет за нерабочие ссылки).
 * iOS: спрашиваем у Apple (iTunes Lookup), есть ли приложение в App Store.
 */
let liveCache: boolean | null = null;
async function santaIsLive(): Promise<boolean> {
  if (liveCache !== null) return liveCache;
  if (Platform.OS === 'android') return (liveCache = SANTA_ON_GOOGLE_PLAY);
  try {
    const r = await fetch(`https://itunes.apple.com/lookup?id=${SANTA_IOS_ID}&country=kz`);
    const j = (await r.json()) as { resultCount?: number };
    liveCache = (j.resultCount ?? 0) > 0;
  } catch {
    return false; // нет сети — просто не показываем, спросим в следующий раз
  }
  return liveCache;
}

export function santaStoreUrl() {
  return Platform.OS === 'android' ? SANTA_GOOGLE_PLAY : SANTA_APP_STORE;
}

/** canHide — на главном экране карточку можно скрыть (в настройках она есть всегда). */
export function SantaPromo({ canHide = false, label }: { canHide?: boolean; label?: string }) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const live = await santaIsLive();
      const dismissed = canHide ? await AsyncStorage.getItem(HIDE_KEY).catch(() => null) : null;
      if (alive) setHidden(!live || dismissed === '1');
    })();
    return () => {
      alive = false;
    };
  }, [canHide]);

  if (hidden !== false) return null;

  const card = (
    <Card>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 34 }}>🎅</Text>
        <View style={{ flex: 1, gap: 4 }}>
          <T style={{ ...F.bodyBold, fontSize: 16 }}>{t('promo.santa.title')}</T>
          <T muted style={{ fontSize: 13 }}>{t('promo.santa.sub')}</T>
        </View>
        {canHide ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('promo.hide')}
            hitSlop={12}
            onPress={() => {
              setHidden(true);
              AsyncStorage.setItem(HIDE_KEY, '1').catch(() => {});
            }}
          >
            <Text style={{ color: C.muted, fontSize: 18 }}>✕</Text>
          </Pressable>
        ) : null}
      </View>
      <Button
        kind="primary"
        title={Platform.OS === 'android' ? t('promo.santa.play') : t('promo.santa.appStore')}
        onPress={() => Linking.openURL(santaStoreUrl()).catch(() => {})}
      />
    </Card>
  );
  return label ? (
    <View style={{ gap: 8 }}>
      <Label>{label}</Label>
      {card}
    </View>
  ) : (
    card
  );
}
