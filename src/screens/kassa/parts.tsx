import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, CopyButton, Hint, Label, Pill, SectionHead } from '../../components/ui';
import { useI18n } from '../../i18n';
import { KassaState } from '../../lib/api';
import { currentMeeting, ownerName, peopleCount, queueText, seatName, shareOf } from '../../lib/texts';
import { C, F, onTheme } from '../../theme';

export { peopleCount };

/** Сумма кассы месяца: взносы всех, кроме хозяина. */
export const kassaTotal = (st: KassaState, holderSeatId: string | null) =>
  st.seats.filter((x) => x.position !== null && x.id !== holderSeatId).reduce((a, x) => a + shareOf(st, x.id), 0);

export function Plate({ st }: { st: KassaState }) {
  const i = useI18n();
  const { t } = i;
  const m = currentMeeting(st);

  let label: string;
  let head: string;
  let body: React.ReactNode = null;
  if (st.kassa.status === 'open') {
    label = t('plate.notDrawnLabel');
    head = st.kassa.is_owner ? t('plate.notDrawnOwner') : t('plate.notDrawn');
    const target = st.kassa.target_size;
    body = (
      <>
      {target ? (
        <View style={{ gap: 8 }}>
          <Text style={p.big}>{t('plate.joined', { a: st.seats.length, b: target })}</Text>
          <View style={p.track}>
            <View style={[p.fill, { width: `${Math.min(100, (st.seats.length / target) * 100)}%` }]} />
          </View>
        </View>
      ) : null}
      <Text style={p.meta}>
        {t('plate.counts', { seats: st.seats.length, people: peopleCount(st) })} · {t('plate.organizer', { name: ownerName(st) })}
      </Text>
      </>
    );
  } else if (!m) {
    label = t('plate.finishedLabel');
    head = t('plate.finished');
  } else {
    label = t('plate.takes', { month: i.monthLabel(m.month) });
    head = m.holder_name ?? seatName(st, m.holder_seat_id);
    body = (
      <>
        <View style={{ gap: 4 }}>
          <Label>{t('plate.amount')}</Label>
          <Text style={p.big}>
            {i.money(kassaTotal(st, m.holder_seat_id)).replace(/ ₸$/, '')}
            <Text style={{ color: C.accent, fontSize: 18 }}> ₸</Text>
          </Text>
        </View>
        <View style={p.metaRow}>
          <Text style={p.meta}>
            <Text style={{ color: C.fg }}>{m.meet_date ? i.dateLabel(m.meet_date) : t('plate.noDate')}</Text>
            {m.meet_date && m.meet_time ? `, ${m.meet_time}` : ''}
          </Text>
          <Text style={[p.meta, m.place ? { color: C.fg } : null]}>{m.place || t('plate.noPlace')}</Text>
        </View>
      </>
    );
  }

  return (
    <View style={p.plate}>
      <View style={p.ring} pointerEvents="none" />
      <Label>{label}</Label>
      <Text style={p.holder}>{head}</Text>
      {body}
    </View>
  );
}

export function QueueCard({ st, withCopy = true }: { st: KassaState; withCopy?: boolean }) {
  const i = useI18n();
  const { t } = i;
  if (!st.meetings.length) return null;
  const cur = currentMeeting(st);
  const curIdx = cur?.idx ?? -1;
  const first = st.meetings[0].month;
  const last = st.meetings[st.meetings.length - 1].month;
  return (
    <Card>
      <SectionHead title={t('queue.title')} right={`${i.monthLabel(first)} — ${i.monthLabel(last)}`} />
      <View style={{ gap: 2 }}>
        {st.meetings.map((m) => {
          const now = m.id === cur?.id;
          const mine = m.holder_seat_id === st.my_seat_id;
          return (
            <View key={m.id} style={[p.sline, now && { backgroundColor: C.accentSoft }]}>
              <Text style={[p.mo, now && { color: C.accent }, m.closed && { ...F.body }]}>{i.monthLabel(m.month)}</Text>
              <Text numberOfLines={2} style={[p.nm, m.closed && { color: C.muted, ...F.body }]}>
                {m.holder_name ?? seatName(st, m.holder_seat_id)}
                {mine ? <Text style={{ color: C.accent }}> · {t('common.you')}</Text> : null}
              </Text>
              {m.closed ? (
                <Pill tone="ok" text={t('queue.done')} />
              ) : now ? (
                <Pill tone="now" text={t('queue.now')} />
              ) : (
                <Pill tone="wait" text={m.idx === curIdx + 1 ? t('queue.next') : t('queue.wait')} />
              )}
            </View>
          );
        })}
      </View>
      {withCopy ? (
        <>
          <CopyButton title={t('queue.copy')} doneTitle={t('common.copied')} text={() => queueText(i, st)} />
          <Hint>{t('queue.copyHint')}</Hint>
        </>
      ) : null}
    </Card>
  );
}

const build_p = () =>
  StyleSheet.create({
  plate: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 18, padding: 20, gap: 12, overflow: 'hidden' },
  ring: { position: 'absolute', right: -50, bottom: -70, width: 190, height: 190, borderRadius: 95, borderWidth: 26, borderColor: C.accent, opacity: 0.08 },
  holder: { color: C.fg, ...F.display, fontSize: 26, lineHeight: 31 },
  big: { color: C.fg, ...F.display, fontSize: 34, lineHeight: 38, fontVariant: ['tabular-nums'] },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, borderTopColor: C.line, borderTopWidth: 1, borderStyle: 'dashed', paddingTop: 12 },
  meta: { color: C.muted, ...F.body, fontSize: 14 },
  track: { height: 6, borderRadius: 3, backgroundColor: C.line, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: C.accent },
  sline: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10 },
  mo: { width: 118, color: C.muted, ...F.bodySemi, fontSize: 14 },
  nm: { flex: 1, color: C.fg, ...F.bodySemi, fontSize: 14 },
});

let p = build_p();
onTheme(() => {
  p = build_p();
});
