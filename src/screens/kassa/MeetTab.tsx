import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { Avatar, Button, Card, CopyButton, Field, Hint, Pill, Row, SectionHead, Segmented, SumLine, T } from '../../components/ui';
import { useI18n } from '../../i18n';
import { KassaState, Meeting, api } from '../../lib/api';
import { maybeAskReview } from '../../lib/review';
import { digits, groupDigits } from '../../lib/num';
import { billSplit, currentMeeting, meetingText, peopleCount, sendToWhatsApp, shareOf } from '../../lib/texts';
import { C, F, scheme } from '../../theme';
import { QueueCard } from './parts';
import { SwapRequests } from './QueueTab';
import { confirm } from './useKassa';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

export function MeetTab({ st, run, goQueue }: { st: KassaState; run: Run; goQueue: () => void }) {
  const i = useI18n();
  const { t } = i;
  const m = currentMeeting(st);

  if (st.kassa.status === 'open')
    return (
      <Card>
        <SectionHead title={t('meet.noQueue')} />
        <Hint>{st.kassa.is_owner ? t('meet.noQueueOwner') : t('meet.noQueueMember')}</Hint>
        {st.kassa.is_owner ? <Button kind="primary" title={t('meet.goDraw')} onPress={goQueue} /> : null}
      </Card>
    );

  return (
    <View style={{ gap: 18 }}>
      {st.swaps.some((r) => r.to_seat === st.my_seat_id) ? <SwapRequests st={st} run={run} /> : null}
      <QueueCard st={st} />
      {m ? <Collection st={st} m={m} run={run} /> : null}
      <MyDebts st={st} />
      <SecretDebts st={st} run={run} />
      {m ? <MeetingCard key={m.id} st={st} m={m} run={run} /> : null}
      {m ? <Dastarkhan key={`d-${m.id}`} st={st} m={m} run={run} /> : null}
    </View>
  );
}

function Collection({ st, m, run }: { st: KassaState; m: Meeting; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const others = st.seats.filter((x) => x.position !== null && x.id !== m.holder_seat_id);
  const pay = new Map(m.payments.map((p) => [p.seat_id, p]));
  const marked = others.filter((x) => pay.has(x.id)).length;
  const holderName = m.holder_name ?? st.seats.find((x) => x.id === m.holder_seat_id)?.name ?? '—';
  const iAmHolder = m.holder_seat_id === st.my_seat_id;
  const manage = m.can_manage;

  const cash = m.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + (p.amount ?? 0), 0);
  const kaspi = m.payments.filter((p) => p.method === 'kaspi').reduce((a, p) => a + (p.amount ?? 0), 0);
  const allIn = marked === others.length;

  const toggle = (seatId: string, method: 'cash' | 'kaspi') => {
    const cur = pay.get(seatId)?.method;
    run(() => api.markPayment(m.id, seatId, cur === method ? null : method));
  };

  return (
    <View style={{ gap: 10 }}>
      <SectionHead title={t('meet.collect')} right={t('meet.paidOf', { a: marked, b: others.length })} />
      {manage && iAmHolder ? <Hint>{t('meet.holderHint')}</Hint> : null}
      {manage && !iAmHolder ? <Hint>{t('meet.proxyHint', { name: holderName })}</Hint> : null}
      <View>
        {others.map((x, idx) => {
          const p = pay.get(x.id);
          const mine = x.id === st.my_seat_id;
          let right: React.ReactNode;
          if (manage) {
            right = (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <PayBtn label={t('meet.cash')} on={p?.method === 'cash'} color={C.ok} onPress={() => toggle(x.id, 'cash')} />
                <PayBtn label={t('meet.kaspi')} on={p?.method === 'kaspi'} color={C.kaspi} onPress={() => toggle(x.id, 'kaspi')} />
              </View>
            );
          } else if (mine && p?.method === 'kaspi' && !p.received) {
            right = <Pill tone="kaspi" text={t('meet.payKaspi')} />;
          } else {
            right = p ? <Pill tone="ok" text={t('meet.paid')} /> : <Pill tone="wait" text={t('meet.notYet')} />;
          }
          return (
            <Row key={x.id} last={idx === others.length - 1}>
              <Avatar name={x.name} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ ...F.bodySemi }}>
                  {x.name}
                  {mine ? <Text style={{ color: C.accent }}> · {t('common.you')}</Text> : null}
                </T>
                <T mono muted style={{ fontSize: 13 }}>{i.money(shareOf(st, x.id))}</T>
              </View>
              {right}
            </Row>
          );
        })}
      </View>
      {manage ? (
        <View style={{ gap: 8 }}>
          <SumLine label={t('meet.onHand')} value={i.money(cash)} />
          <SumLine label={t('meet.promised')} value={i.money(kaspi)} color={C.kaspi} />
          <Button
            kind="primary"
            disabled={!allIn}
            title={allIn ? t('meet.close') : t('meet.closeNeedAll')}
            onPress={async () => {
              if (await confirm(t('meet.closeConfirm', { month: i.monthLabel(m.month) }), t('common.yes'), t('common.cancel')))
                if (await run(() => api.closeMeeting(m.id))) maybeAskReview(st.kassa.id);
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

function PayBtn({ label, on, color, onPress }: { label: string; on: boolean; color: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      hitSlop={4}
      style={{ borderWidth: 1, borderColor: on ? color : C.line, backgroundColor: C.bg, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 10 }}
    >
      <Text style={{ color: on ? color : C.muted, ...F.bodySemi, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function MyDebts({ st }: { st: KassaState }) {
  const i = useI18n();
  const { t } = i;
  if (!st.my_debts.length) return null;
  return (
    <Card tone="secret">
      <SectionHead title={`🔒 ${t('meet.myTransfer')}`} right={t('meet.onlyYouAndHolder')} />
      {st.my_debts.map((d) => (
        <SumLine key={d.meeting_id} label={t('meet.toWhom', { month: i.monthLabel(d.month), name: d.holder_name ?? '—' })} value={i.money(d.amount)} color={C.kaspi} />
      ))}
      <Hint>{t('meet.myTransferHint')}</Hint>
    </Card>
  );
}

function SecretDebts({ st, run }: { st: KassaState; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const debts = st.secret_debts.filter((d) => d.seat_id !== st.my_seat_id);
  if (!debts.length) return null;
  return (
    <Card tone="secret">
      <SectionHead title={`🔒 ${t('meet.secretTitle')}`} right={t('meet.onlyYou')} />
      <View>
        {debts.map((d, idx) => (
          <Row key={`${d.meeting_id}-${d.seat_id}`} last={idx === debts.length - 1}>
            <Avatar name={d.seat_name} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T numberOfLines={1} style={{ ...F.bodySemi }}>{d.seat_name}</T>
              <T muted style={{ fontSize: 13 }}>{t('meet.promisedKaspi', { month: i.monthLabel(d.month) })}</T>
            </View>
            <T mono style={{ color: C.kaspi }}>{i.money(d.amount)}</T>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => run(() => api.confirmKaspi(d.meeting_id, d.seat_id))}>
              <Text style={{ color: C.accent, ...F.bodyBold }}>{t('meet.got')}</Text>
            </Pressable>
          </Row>
        ))}
      </View>
    </Card>
  );
}

const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromIso = (s: string) => {
  const [y, mo, d] = s.split('-').map(Number);
  return new Date(y, mo - 1, d);
};

function MeetingCard({ st, m, run }: { st: KassaState; m: Meeting; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const canEdit = m.can_manage || st.kassa.is_owner;
  const [date, setDate] = useState<string | null>(m.meet_date);
  const [time, setTime] = useState<string>(m.meet_time ?? '19:00');
  const [place, setPlace] = useState(m.place);
  const [busy, setBusy] = useState(false);

  // Если встречу поменял кто-то другой — подтягиваем, пока пользователь не редактирует.
  useEffect(() => {
    setDate(m.meet_date);
    setTime(m.meet_time ?? '19:00');
    setPlace(m.place);
  }, [m.meet_date, m.meet_time, m.place]);

  const dirty = date !== m.meet_date || (date && time !== (m.meet_time ?? '19:00')) || place.trim() !== m.place;
  const text = meetingText(i, st, m);
  const timeDate = useMemo(() => {
    const [h, mi] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h || 19, mi || 0, 0, 0);
    return d;
  }, [time]);

  return (
    <Card>
      <SectionHead title={t('meet.meeting')} right={t('meet.agreed')} />
      {canEdit ? (
        <>
          {date ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {Platform.OS === 'android' ? (
                <>
                  <Button
                    title={i.dateLabel(date)}
                    onPress={() =>
                      DateTimePickerAndroid.open({ value: fromIso(date), mode: 'date', onChange: (e, d) => e.type === 'set' && d && setDate(toIso(d)) })
                    }
                  />
                  <Button
                    title={time}
                    onPress={() =>
                      DateTimePickerAndroid.open({
                        value: timeDate,
                        mode: 'time',
                        is24Hour: true,
                        onChange: (e, d) =>
                          e.type === 'set' && d && setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`),
                      })
                    }
                  />
                </>
              ) : (
                <>
              <DateTimePicker
                value={fromIso(date)}
                mode="date"
                display="compact"
                themeVariant={scheme}
                accentColor={C.accent}
                onChange={(_, d) => d && setDate(toIso(d))}
              />
              <DateTimePicker
                value={timeDate}
                mode="time"
                display="compact"
                themeVariant={scheme}
                accentColor={C.accent}
                minuteInterval={5}
                onChange={(_, d) => d && setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)}
              />
                </>
              )}
              <Pressable onPress={() => setDate(null)} hitSlop={8}>
                <Text style={{ color: C.muted, ...F.bodySemi }}>{t('meet.noDate')}</Text>
              </Pressable>
            </View>
          ) : (
            <Button title={t('meet.setDate')} onPress={() => setDate(toIso(new Date()))} />
          )}
          <Field label={t('meet.place')} placeholder={t('meet.placePh')} value={place} onChangeText={setPlace} maxLength={120} style={{ flex: 0 }} />
          {dirty ? (
            <Button
              kind="primary"
              loading={busy}
              title={t('meet.saveMeeting')}
              onPress={async () => {
                setBusy(true);
                await run(() => api.updateMeeting(m.id, { date, time: date ? time : null, place: place.trim(), bill: m.bill }));
                setBusy(false);
              }}
            />
          ) : null}
        </>
      ) : (
        <Hint>{t('meet.editOnly')}</Hint>
      )}
      <View style={{ backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12 }}>
        <T selectable style={{ fontSize: 14 }}>{text}</T>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <CopyButton style={{ flex: 1 }} title={t('meet.copyChat')} doneTitle={t('common.copied')} text={() => text} />
        <Button style={{ flex: 1 }} title={t('meet.openWa')} onPress={() => sendToWhatsApp(text)} />
      </View>
    </Card>
  );
}

function Dastarkhan({ st, m, run }: { st: KassaState; m: Meeting; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const canEdit = m.can_manage || st.kassa.is_owner;
  const defUnits = (sp: 'person' | 'seat') => (sp === 'person' ? peopleCount(st) : st.seats.length);
  const [split, setSplit] = useState<'person' | 'seat'>(m.bill_split);
  const [bill, setBill] = useState(m.bill ? groupDigits(String(m.bill)) : '');
  const [units, setUnits] = useState(String(m.bill_people ?? defUnits(m.bill_split)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSplit(m.bill_split);
    setBill(m.bill ? groupDigits(String(m.bill)) : '');
    setUnits(String(m.bill_people ?? defUnits(m.bill_split)));
  }, [m.bill, m.bill_split, m.bill_people]); // eslint-disable-line react-hooks/exhaustive-deps

  const b = Number(digits(bill));
  const n = Number(digits(units));
  const { per, pair } = billSplit(b, split, n);
  const dirty = b !== m.bill || split !== m.bill_split || n !== (m.bill_people ?? defUnits(m.bill_split));

  return (
    <Card>
      <SectionHead title={t('meet.dastarkhan')} right={t('meet.dastarkhanSub')} />
      <Segmented
        value={split}
        onChange={(v) => {
          if (!canEdit) return;
          setSplit(v);
          setUnits(String(defUnits(v)));
        }}
        options={[
          { value: 'person', label: t('meet.splitPerson') },
          { value: 'seat', label: t('meet.splitSeat') },
        ]}
      />
      <Hint>{split === 'person' ? t('meet.splitPersonHint') : t('meet.splitSeatHint')}</Hint>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field label={t('meet.bill')} value={bill} editable={canEdit} onChangeText={(v) => setBill(groupDigits(v))} keyboardType="number-pad" placeholder="0" />
        <Field
          label={split === 'person' ? t('meet.peopleAtTable') : t('meet.seatsAtTable')}
          value={units}
          editable={canEdit}
          onChangeText={(v) => setUnits(digits(v).slice(0, 3))}
          keyboardType="number-pad"
        />
      </View>
      {split === 'person' ? (
        <>
          <SumLine label={t('meet.perPerson')} value={per ? i.money(per) : '—'} />
          <SumLine label={t('meet.perPair')} value={pair ? i.money(pair) : '—'} />
        </>
      ) : (
        <SumLine label={t('meet.perSeat')} value={per ? i.money(per) : '—'} />
      )}
      {canEdit && dirty ? (
        <Button
          kind="primary"
          loading={busy}
          title={t('meet.saveBill')}
          onPress={async () => {
            setBusy(true);
            await run(() =>
              api.updateMeeting(m.id, { date: m.meet_date, time: m.meet_time, place: m.place, bill: b, split, people: n || null }),
            );
            setBusy(false);
          }}
        />
      ) : null}
      {!canEdit ? <Hint>{t('meet.billReadOnly')}</Hint> : null}
    </Card>
  );
}
