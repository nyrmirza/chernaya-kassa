import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

/**
 * Push с сервера: «все в сборе — можно жеребьёвку» (организатору) и результат жеребьёвки (всем).
 * Токен устройства привязывается к текущему пользователю и языку приложения.
 */
let last = '';

function projectId(): string | undefined {
  const extra = (Constants.expoConfig?.extra ?? {}) as { eas?: { projectId?: string } };
  return extra.eas?.projectId ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
}

export async function registerPush(lang: string) {
  try {
    // Android в Expo Go push не поддерживает — только в настоящей сборке.
    if (Platform.OS === 'android' && Constants.appOwnership === 'expo') return;
    const id = projectId();
    if (!id) return; // проект ещё не связан с EAS (npx eas-cli init)

    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const sig = `${token}|${lang}`;
    if (sig === last) return;
    await api.registerPush(token, lang);
    last = sig;
  } catch {
    // Push не критичен — без него всё работает, просто без уведомлений с сервера.
  }
}

/** После смены аккаунта — заново привязать токен. */
export function resetPush() {
  last = '';
}
