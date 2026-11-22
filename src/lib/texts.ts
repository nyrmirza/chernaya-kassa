import Constants from 'expo-constants';
import { Linking, Share } from 'react-native';
import { useI18n } from '../i18n';
import { KassaState, Meeting, Poll } from './api';

const LINK_HOST = ((Constants.expoConfig?.extra ?? {}) as { linkHost?: string }).linkHost ?? 'chernaya-kassa-kz.web.app';

/** Ссылка-приглашение: есть приложение — откроет вход в кассу, нет — App Store. */
export const joinLink = (code: string) => `https://${LINK_HOST}/j/${code}`;
/** Личная ссылка для второго из пары. */
export const partnerLink = (token: string) => `https://${LINK_HOST}/p/${token}`;

type I = ReturnType<typeof useI18n>;

export const seatName = (st: KassaState, id: string | null) => st.seats.find((x) => x.id === id)?.name ?? '—';
export const ownerName = (st: KassaState) => st.seats.find((x) => x.is_owner)?.name ?? '—';
export const shareOf = (st: KassaState, seatId: string) =>
  st.seats.find((x) => x.id === seatId)?.kind === 'pair' ? st.kassa.share_pair : st.kassa.share_single;

/** Первая незакрытая встреча текущего круга. */
export const currentMeeting = (st: KassaState): Meeting | null => st.meetings.find((m) => !m.closed) ?? null;

export function shareLine(i: I, st: KassaState) {
  const { share_pair: a, share_single: b } = st.kassa;
  return a === b ? i.t('text.shareSame', { a: i.money(a) }) : i.t('text.shareDiff', { a: i.money(a), b: i.money(b) });
}


/** Текст для описания WhatsApp-группы: очередь + код + промо приложения. */
export function queueText(i: I, st: KassaState) {
  const cur = currentMeeting(st);
  const lines = st.meetings.map((m) => {
    const mark = m.closed ? ' ✓' : m.id === cur?.id ? ` ${i.t('text.now')}` : '';
    return `${i.monthLabel(m.month)} — ${m.holder_name ?? seatName(st, m.holder_seat_id)}${mark}`;
  });
  return [
    i.t('text.header', { title: st.kassa.title }),
    '',
    i.t('text.queue'),
    ...lines,
    '',
    i.t('text.share', { share: shareLine(i, st) }),
    i.t('text.organizer', { name: ownerName(st) }),
    '',
    i.t('text.promo', { link: joinLink(st.kassa.code), code: st.kassa.code }),
  ].join('\n');
}

export function partnerInviteText(i: I, st: KassaState, token: string, partner: string) {
  return i.t('text.partner', { name: partner, title: st.kassa.title, link: partnerLink(token), code: token });
}

export function inviteText(i: I, st: KassaState) {
  return i.t('text.invite', { title: st.kassa.title, link: joinLink(st.kassa.code), code: st.kassa.code });
}

export function meetingText(i: I, st: KassaState, m: Meeting) {
  const date = m.meet_date ? i.dateLabel(m.meet_date) + (m.meet_time ? `, ${m.meet_time}` : '') : i.t('text.tbd');
  return [
    i.t('text.meetHeader', { month: i.monthLabel(m.month) }),
    i.t('text.date', { date }),
    i.t('text.place', { place: m.place || i.t('text.tbd') }),
    i.t('text.holder', { name: m.holder_name ?? seatName(st, m.holder_seat_id) }),
    i.t('text.share', { share: shareLine(i, st) }),
    ...(m.bill > 0 ? [billLine(i, st, m)] : []),
  ].join('\n');
}

export const peopleCount = (st: KassaState) => st.seats.reduce((a, x) => a + (x.kind === 'pair' ? 2 : 1), 0);

/** Сколько платит каждый: режим «на человека» (пара ×2) или «на место» (пара = одиночка). */
export function billSplit(bill: number, split: 'person' | 'seat', units: number) {
  if (!bill || !units) return { per: 0, pair: 0 };
  const per = Math.ceil(bill / units);
  return { per, pair: split === 'person' ? per * 2 : per };
}

export function billLine(i: I, st: KassaState, m: Meeting) {
  const units = m.bill_people ?? (m.bill_split === 'person' ? peopleCount(st) : st.seats.length);
  const { per, pair } = billSplit(m.bill, m.bill_split, units);
  return m.bill_split === 'person'
    ? i.t('text.billPerson', { bill: i.money(m.bill), per: i.money(per), pair: i.money(pair) })
    : i.t('text.billSeat', { bill: i.money(m.bill), per: i.money(per) });
}

export function pollText(i: I, st: KassaState, p: Poll) {
  const options = p.options.map((o) => `• ${o.text}`).join('\n');
  return i.t('text.poll', { title: st.kassa.title, q: p.question, options, link: joinLink(st.kassa.code) });
}

/**
 * Отправить текст в WhatsApp целиком (текст + ссылка).
 * Ссылка wa.me на iOS теряет текст, если в нём есть другая ссылка, поэтому открываем
 * сам WhatsApp через whatsapp://send. Если WhatsApp нет — системное меню «Поделиться».
 */
export async function sendToWhatsApp(text: string) {
  try {
    await Linking.openURL(`whatsapp://send?text=${encodeURIComponent(text)}`);
  } catch {
    await Share.share({ message: text }).catch(() => {});
  }
}
