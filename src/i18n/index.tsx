import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError } from '../lib/api';
import { Key, Lang, MONTHS, STRINGS } from './strings';

const LANG_KEY = 'kassa.lang';

function deviceLang(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'ru';
  return code === 'kk' ? 'kk' : code === 'en' ? 'en' : 'ru';
}

type Params = Record<string, string | number>;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, params?: Params) => string;
  money: (n: number) => string;
  monthLabel: (iso: string) => string; // «Октябрь 2026»
  monthName: (iso: string) => string; // «Октябрь»
  dateLabel: (iso: string | null) => string; // «Сб, 31 октября»
  errorText: (e: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);

function parseIso(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m: m - 1, d: d || 1 };
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(deviceLang());

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY)
      .then((v) => {
        if (v === 'ru' || v === 'kk' || v === 'en') setLangState(v);
      })
      .catch(() => {});
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(LANG_KEY, l).catch(() => {});
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = STRINGS[lang];
    const months = MONTHS[lang];
    const t = (key: Key, params?: Params) => {
      let s = dict[key] ?? STRINGS.ru[key] ?? key;
      if (params) for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
      return s;
    };
    const money = (n: number) =>
      String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸';
    const monthName = (iso: string) => months.nom[parseIso(iso).m];
    const monthLabel = (iso: string) => {
      const { y, m } = parseIso(iso);
      return `${months.nom[m]} ${y}`;
    };
    const dateLabel = (iso: string | null) => {
      if (!iso) return t('plate.noDate');
      const { y, m, d } = parseIso(iso);
      const wd = months.short[new Date(y, m, d).getDay()];
      return lang === 'en' ? `${wd}, ${months.gen[m]} ${d}` : `${wd}, ${d} ${months.gen[m]}`;
    };
    const errorText = (e: unknown) => {
      const code = e instanceof ApiError ? e.code : 'NETWORK';
      const key = `err.${code}` as Key;
      return key in dict ? t(key) : t('err.generic', { code });
    };
    return { lang, setLang, t, money, monthLabel, monthName, dateLabel, errorText };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
