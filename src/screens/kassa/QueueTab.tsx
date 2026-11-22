import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Button, Card, CopyButton, Hint, Label, Pill, SectionHead, T } from '../../components/ui';
import { useI18n } from '../../i18n';
import { maybeAskReview } from '../../lib/review';
import { KassaState, Meeting, api } from '../../lib/api';
import { currentMeeting, ownerName, queueText, seatName } from '../../lib/texts';
import { C, F } from '../../theme';
import { confirm } from './useKassa';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

const shiftMonth = (iso: string, delta: number) => {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

const holder = (st: KassaState, m: Meeting) => m.holder_name ?? seatName(st, m.holder_seat_id);
/** Можно ли менять месяц: не прошёл и в нём ещё не начали сдавать. */
const swappable = (m: Meeting) => !m.closed && m.payments.length === 0;

export function QueueTab({ st, run }: { st: KassaState; run: Run }) {
  const k = st.kassa;
  if (k.status === 'open') return <DrawCard st={st} run={run} />;
  return (
    <View style={{ gap: 18 }}>
      <SwapRequests st={st} run={run} />
      <QueueList st={st} run={run} />
      <RoundControls st={st} run={run} />
      <History st={st} />
    </View>
  );
}

function DrawCard({ st, run }: { st: KassaState; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const k = st.kassa;
  const owner = k.is_owner;
  const target = k.target_size;
  const joined = st.seats.length;
  const ready = joined >= 2 && (!target || joined >= target);

  const save = (patch: { start?: string; size?: number }) =>
    run(() =>
      api.updateKassa(k.id, {
        title: k.title,
        sharePair: k.share_pair,
        shareSingle: k.share_single,
        start: patch.start ?? null,
        size: patch.size ?? null,
      }),
    );

  return (
    <View style={{ gap: 18 }}>
      <Card>
        <SectionHead title={t('queue.drawTitle')} right={target ? t('join.seatsCount', { a: joined, b: target }) : t('home.seats', { n: joined })} />
        {target && joined < target ? <Hint>{t('queue.waitAll', { a: joined, b: target })}</Hint> : null}
        {owner ? (
          <>
            {target ? (
              <Stepper
                label={t('queue.size')}
                value={String(target)}
                onMinus={() => target > Math.max(2, joined) && save({ size: target - 1 })}
                onPlus={() => target < 50 && save({ size: target + 1 })}
              />
            ) : null}
            <Stepper
              label={t('queue.startMonth')}
              value={i.monthLabel(k.start_month)}
              onMinus={() => save({ start: shiftMonth(k.start_month, -1) })}
              onPlus={() => save({ start: shiftMonth(k.start_month, 1) })}
            />
            <Hint>{t('queue.drawHintOwner')}</Hint>
            <Button kind="primary" title={t('queue.draw')} disabled={!ready} onPress={async () => { if (await run(() => api.draw(k.id))) maybeAskReview(k.id); }} />
            {joined < 2 ? <Hint>{t('queue.needTwo')}</Hint> : null}
          </>
        ) : (
          <Hint>{t('queue.drawHintMember', { name: ownerName(st) })}</Hint>
        )}
      </Card>
      <History st={st} />
    </View>
  );
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 10 }}>
        <Arrow label="−" onPress={onMinus} />
        <Text style={{ color: C.fg, ...F.bodyBold, fontSize: 16 }}>{value}</Text>
        <Arrow label="+" onPress={onPlus} />
      </View>
    </View>
  );
}

function Arrow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={{ paddingHorizontal: 18, paddingVertical: 10 }}>
      <Text style={{ color: C.accent, ...F.bodyBold, fontSize: 22 }}>{label}</Text>
    </Pressable>
  );
}

/** Очередь со статусами; участник может предложить обмен, организатор — переставить сам. */
function QueueList({ st, run }: { st: KassaState; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const k = st.kassa;
  const cur = currentMeeting(st);
  const curIdx = cur?.idx ?? -1;
  const mine = st.meetings.find((m) => m.holder_seat_id === st.my_seat_id);
  const [ordering, setOrdering] = useState(false);
  const [picked, setPicked] = useState<Meeting | null>(null);
  const drawn = k.status === 'drawn';

  const asked = new Set(st.swaps.filter((s) => s.from_seat === st.my_seat_id).map((s) => s.to_seat));

  const onPick = async (m: Meeting) => {
    if (!picked) return setPicked(m);
    if (picked.id === m.id) return setPicked(null);
    const a = picked;
    setPicked(null);
    if (await confirm(t('queue.ownerSwapConfirm', { a: holder(st, a), b: holder(st, m) }), t('common.yes'), t('common.cancel')))
      run(() => api.swapQueue(k.id, a.holder_seat_id!, m.holder_seat_id!));
  };

  const ask = async (m: Meeting) => {
    if (!mine) return;
    const ok = await confirm(
      t('queue.swapAskConfirm', { name: holder(st, m), mine: i.monthName(mine.month).toLowerCase(), theirs: i.monthName(m.month).toLowerCase() }),
      t('common.yes'),
      t('common.cancel'),
    );
    if (ok) run(() => api.requestSwap(k.id, m.holder_seat_id!));
  };

  const canAsk = drawn && !ordering && mine && swappable(mine);

  return (
    <Card>
      <SectionHead
        title={t('queue.title')}
        right={st.meetings.length ? `${i.monthLabel(st.meetings[0].month)} — ${i.monthLabel(st.meetings[st.meetings.length - 1].month)}` : undefined}
      />
      {ordering ? <Hint>{t('queue.ownerSwapHint')}</Hint> : canAsk ? <Hint>{t('queue.swapHint')}</Hint> : null}
      <View style={{ gap: 2 }}>
        {st.meetings.map((m) => {
          const now = m.id === cur?.id;
          const isMine = m.holder_seat_id === st.my_seat_id;
          const sel = picked?.id === m.id;
          let right: React.ReactNode;
          if (ordering && swappable(m)) {
            right = (
              <Pressable accessibilityRole="button" onPress={() => onPick(m)} hitSlop={8}>
                <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: sel ? C.accent : C.line, alignItems: 'center', justifyContent: 'center' }}>
                  {sel ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} /> : null}
                </View>
              </Pressable>
            );
          } else if (canAsk && !isMine && swappable(m) && m.holder_seat_id) {
            right = asked.has(m.holder_seat_id) ? (
              <Pill tone="wait" text="…" />
            ) : (
              <Pressable accessibilityRole="button" onPress={() => ask(m)} hitSlop={8}>
                <Text style={{ color: C.accent, ...F.bodyBold, fontSize: 13 }}>{t('queue.swapAsk')}</Text>
              </Pressable>
            );
          } else if (m.closed) right = <Pill tone="ok" text={t('queue.done')} />;
          else if (now) right = <Pill tone="now" text={t('queue.now')} />;
          else right = <Pill tone="wait" text={m.idx === curIdx + 1 ? t('queue.next') : t('queue.wait')} />;

          return (
            <View
              key={m.id}
              style={[
                { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10 },
                now && !ordering && { backgroundColor: C.accentSoft },
                sel && { backgroundColor: C.accentStrong },
              ]}
            >
              <Text style={{ width: 112, color: now ? C.accent : C.muted, ...(m.closed ? F.body : F.bodySemi), fontSize: 14 }}>{i.monthLabel(m.month)}</Text>
              <Text numberOfLines={2} style={{ flex: 1, color: m.closed ? C.muted : C.fg, ...(m.closed ? F.body : F.bodySemi), fontSize: 14 }}>
                {holder(st, m)}
                {isMine ? <Text style={{ color: C.accent }}> · {t('common.you')}</Text> : null}
              </Text>
              {right}
            </View>
          );
        })}
      </View>
      <CopyButton title={t('queue.copy')} doneTitle={t('common.copied')} text={() => queueText(i, st)} />
      {k.is_owner && drawn ? (
        <Button
          title={ordering ? t('queue.ownerSwapDone') : t('queue.ownerSwap')}
          onPress={() => {
            setOrdering(!ordering);
            setPicked(null);
          }}
        />
      ) : null}
    </Card>
  );
}

export function SwapRequests({ st, run }: { st: KassaState; run: Run }) {
  const i = useI18n();
  const { t } = i;
  if (!st.swaps.length) return null;
  const monthOf = (seat: string) => {
    const m = st.meetings.find((x) => x.holder_seat_id === seat);
    return m ? i.monthName(m.month).toLowerCase() : '—';
  };
  return (
    <Card tone="invite">
      <SectionHead title={t('queue.swapTitle')} />
      {st.swaps.map((r) => {
        const incoming = r.to_seat === st.my_seat_id;
        const outgoing = r.from_seat === st.my_seat_id;
        return (
          <View key={r.id} style={{ gap: 10 }}>
            <T>
              {incoming
                ? t('queue.swapIncoming', { name: r.from_name, mine: monthOf(r.to_seat), theirs: monthOf(r.from_seat) })
                : outgoing
                  ? t('queue.swapOutgoing', { name: r.to_name, mine: monthOf(r.from_seat), theirs: monthOf(r.to_seat) })
                  : t('queue.swapOther', { from: r.from_name, to: r.to_name })}
            </T>
            {incoming ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button kind="primary" style={{ flex: 1 }} title={t('queue.accept')} onPress={() => run(() => api.respondSwap(r.id, true))} />
                <Button style={{ flex: 1 }} title={t('queue.decline')} onPress={() => run(() => api.respondSwap(r.id, false))} />
              </View>
            ) : outgoing || st.kassa.is_owner ? (
              <Button title={t('queue.cancelSwap')} onPress={() => run(() => api.cancelSwap(r.id))} />
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

function RoundControls({ st, run }: { st: KassaState; run: Run }) {
  const { t } = useI18n();
  const k = st.kassa;
  if (!k.is_owner) return null;
  const started = st.meetings.some((m) => m.closed);
  if (k.status === 'finished')
    return (
      <Button
        kind="primary"
        title={t('queue.newRound')}
        onPress={async () => {
          if (await confirm(t('queue.newRoundConfirm'), t('common.yes'), t('common.cancel'))) run(() => api.newRound(k.id));
        }}
      />
    );
  if (started) return <Hint>{t('queue.roundStarted')}</Hint>;
  return (
    <Button
      title={t('queue.redraw')}
      onPress={async () => {
        if (await confirm(t('queue.redrawConfirm'), t('common.yes'), t('common.cancel'), true)) run(() => api.resetDraw(k.id));
      }}
    />
  );
}

function History({ st }: { st: KassaState }) {
  const i = useI18n();
  const { t } = i;
  if (!st.history.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <SectionHead title={t('queue.history')} />
      {st.history.map((r) => (
        <Card key={r.round}>
          <SectionHead
            title={t('queue.roundN', { n: r.round })}
            right={r.meetings.length ? `${i.monthLabel(r.meetings[0].month)} — ${i.monthLabel(r.meetings[r.meetings.length - 1].month)}` : undefined}
          />
          {r.meetings.map((m, idx) => (
            <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ width: 112, color: C.muted, ...F.bodySemi, fontSize: 14 }}>{i.monthLabel(m.month)}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontSize: 14, ...F.bodySemi }}>{m.holder_name ?? '—'}</T>
                {m.place ? <T muted numberOfLines={1} style={{ fontSize: 12 }}>{m.place}</T> : null}
              </View>
              <T mono muted style={{ fontSize: 13 }}>{t('queue.collected', { sum: i.money(m.collected) })}</T>
            </View>
          ))}
        </Card>
      ))}
    </View>
  );
}
