import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const KEY = 'kassa.demo';

/** Создать демо-кассу на языке приложения и запомнить, на каком языке она сделана. */
export async function startDemo(lang: string) {
  const id = await api.startDemo(lang);
  await AsyncStorage.setItem(KEY, JSON.stringify({ id, lang })).catch(() => {});
  return id;
}

/**
 * Язык сменился — пересоздать демо на новом языке (если оно есть и сделано на другом).
 * Возвращает true, если демо обновлено.
 */
export async function syncDemoLang(lang: string, existingIds: string[]) {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return false;
    const d = JSON.parse(raw) as { id: string; lang: string };
    if (!existingIds.includes(d.id)) {
      await AsyncStorage.removeItem(KEY);
      return false;
    }
    if (d.lang === lang) return false;
    await startDemo(lang);
    return true;
  } catch {
    return false;
  }
}
