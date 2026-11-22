import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import { Linking, Platform } from 'react-native';
import { isDemoKassa } from './reminders';

// Оценка приложения.
// 1) Системное окно (App Store / Google Play) — после приятного момента: жеребьёвка прошла,
//    встреча закрыта. Не чаще раза в 120 дней и не в демо-кассе. Сколько раз реально
//    показать окно, решают Apple и Google (iOS — не больше 3 раз в год).
// 2) Кнопка «Оценить приложение» в настройках — открывает страницу отзыва в магазине.

const KEY = 'kassa.review.askedAt';
const GAP_DAYS = 120;

export const STORE_REVIEW_URL = Platform.select({
  ios: 'https://apps.apple.com/app/id6827977401?action=write-review',
  default: 'https://play.google.com/store/apps/details?id=kz.nurbakyt.chernayakassa&showAllReviews=true',
});

export async function maybeAskReview(kassaId?: string) {
  try {
    if (kassaId && (await isDemoKassa(kassaId))) return;
    const last = Number((await AsyncStorage.getItem(KEY)) || 0);
    if (Date.now() - last < GAP_DAYS * 86400000) return;
    if (!(await StoreReview.isAvailableAsync())) return;
    await AsyncStorage.setItem(KEY, String(Date.now()));
    // Небольшая пауза, чтобы окно не перекрыло результат действия.
    setTimeout(() => StoreReview.requestReview().catch(() => {}), 1500);
  } catch {
    // Оценка не критична.
  }
}

export function openStoreReview() {
  Linking.openURL(STORE_REVIEW_URL).catch(() => {});
}
