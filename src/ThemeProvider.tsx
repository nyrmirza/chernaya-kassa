import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import { C, Scheme, ThemeMode, applyScheme } from './theme';

const KEY = 'kassa.theme';

interface ThemeCtx {
  mode: ThemeMode;
  scheme: Scheme;
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({ mode: 'system', scheme: 'dark', setMode: () => {} });

/** Тема: системная / тёмная / светлая. При смене палитры дерево перерисовывается заново. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'dark' || v === 'light' || v === 'system') setModeState(v);
      })
      .catch(() => {});
  }, []);

  const scheme: Scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  applyScheme(scheme);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(KEY, m).catch(() => {});
  };

  return (
    <Ctx.Provider value={{ mode, scheme, setMode }}>
      <View key={scheme} style={{ flex: 1, backgroundColor: C.bg }}>
        {children}
      </View>
    </Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);
