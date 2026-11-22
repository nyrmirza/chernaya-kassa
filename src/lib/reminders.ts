import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useI18n } from '../i18n';
import { KassaState } from './api';
import { currentMeeting, seatName, shareLine } from './texts';

type I = ReturnType<typeof useI18n>;

const ENABLED_KEY = 'kassa.reminders';
const REMIND_HOUR = 10; // напоминания за 3 дня и за 1 день приходят в 10:00

/** Что уже запланировано по каждой кассе — чтобы не перепланировать при каждом обновлении экрана. */
const planned = new Map<string, string>();

const CHANNEL = 'meetings';

export function setupNotifications() {
  // Android: уведомления показываются только через канал.
  if (Platform.OS === 'android')
    Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Встречи / Кездесулер',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
  // Канал для push с сервера (жеребьёвка, «все в сборе»).
  if (Platform.OS === 'android')
    Notifications.setNotificationChannelAsync('kassa', {
      name: 'Касса',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => {});
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function remindersEnabled() {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) !== 'off';
  } catch {
    return true;
  }
}

export async function setRemindersEnabled(on: boolean) {
  await AsyncStorage.setItem(ENABLED_KEY, on ? 'on' : 'off').catch(() => {});
  planned.clear();
  if (!on) await cancelAll();
}

async function cancelAll() {
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    all.filter((n) => n.content.data?.kind === 'meeting').map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

async function cancelFor(kassaId: string) {
  const all = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    all
      .filter((n) => n.content.data?.kind === 'meeting' && n.content.data?.kassa === kassaId)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );
}

export async function isDemoKassa(id: string) {
  try {
    const raw = await AsyncStorage.getItem('kassa.demo');
    return !!raw && (JSON.parse(raw) as { id: string }).id === id;
  } catch {
    return false;
  }
}

/**
 * Снять напоминания касс, которых больше нет в списке (удалённое или пересозданное демо,
 * касса, из которой вышли), и все напоминания демо-кассы.
 */
export async function pruneReminders(validIds: string[]) {
  try {
    const keep = new Set(validIds);
    const all = await Notifications.getAllScheduledNotificationsAsync();
    const stale = [];
    for (const n of all) {
      const kassa = n.content.data?.kassa;
      if (n.content.data?.kind !== 'meeting' || typeof kassa !== 'string') continue;
      if (!keep.has(kassa) || (await isDemoKassa(kassa))) stale.push(n.identifier);
    }
    await Promise.all(stale.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
    for (const id of [...planned.keys()]) if (!keep.has(id)) planned.delete(id);
  } catch {
    // не критично
  }
}

async function hasPermission(ask: boolean) {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!ask || !cur.canAskAgain) return false;
  const res = await Notifications.requestPermissionsAsync();
  return res.granted;
}

/**
 * Локальные напоминания о встрече текущего месяца: за 3 дня, за 1 день и в день сбора — с местом и временем.
 * Вызывается при каждом открытии кассы, поэтому новая дата или место подхватываются сами.
 */
export async function syncReminders(st: KassaState, i: I) {
  try {
    // Демо-касса — не настоящая встреча: напоминаний для неё не ставим.
    if (await isDemoKassa(st.kassa.id)) {
      planned.delete(st.kassa.id);
      await cancelFor(st.kassa.id);
      return;
    }
    if (!(await remindersEnabled())) return;
    const m = currentMeeting(st);
    const sig = m ? [m.id, m.meet_date, m.meet_time, m.place, i.lang].join('|') : 'none';
    if (planned.get(st.kassa.id) === sig) return;
    planned.set(st.kassa.id, sig);

    // Снимаем старые напоминания этой кассы.
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      all
        .filter((n) => n.content.data?.kind === 'meeting' && n.content.data?.kassa === st.kassa.id)
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
    );
    if (!m || !m.meet_date) return;
    if (!(await hasPermission(true))) return;

    const [y, mo, d] = m.meet_date.split('-').map(Number);
    const [hh, mm] = (m.meet_time ?? '19:00').split(':').map(Number);
    const event = new Date(y, mo - 1, d, hh, mm);
    const time = m.meet_time ?? '19:00';
    const place = m.place || i.t('text.tbd');
    const holder = m.holder_name ?? seatName(st, m.holder_seat_id);
    const params = { date: i.dateLabel(m.meet_date), time, place, holder, share: shareLine(i, st) };

    const at = (daysBefore: number, hour: number) => {
      const x = new Date(y, mo - 1, d - daysBefore, hour, 0);
      return x;
    };
    // В день сбора — в 10:00, но не позже чем за 2 часа до встречи.
    const dayOf = new Date(Math.min(at(0, REMIND_HOUR).getTime(), event.getTime() - 2 * 3600 * 1000));

    const plan = [
      { when: at(3, REMIND_HOUR), body: i.t('notif.in3', params) },
      { when: at(1, REMIND_HOUR), body: i.t('notif.in1', params) },
      { when: dayOf, body: i.t('notif.today', params) },
    ];
    const now = Date.now();
    for (const [n, p] of plan.entries()) {
      if (p.when.getTime() <= now + 60 * 1000) continue;
      // Постоянный идентификатор: повторный вызов заменяет напоминание, а не добавляет второе.
      await Notifications.scheduleNotificationAsync({
        identifier: `meeting-${st.kassa.id}-${n}`,
        content: { title: st.kassa.title, body: p.body, data: { kind: 'meeting', kassa: st.kassa.id } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: p.when, channelId: CHANNEL },
      });
    }
  } catch {
    // Напоминания — не критично: если что-то не так с разрешениями, касса работает как обычно.
  }
}
