import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { NamesFields, emptyNames, namesArray, namesError, seatLabel } from '../../src/components/NamesFields';
import { Avatar, Button, Card, ErrorText, Hint, Label, Row, Segmented, T } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';
import { KassaPreview, api } from '../../src/lib/api';
import { cleanCode } from '../../src/lib/num';
import { C, F } from '../../src/theme';

/** new — новое место; manual — место, добавленное организатором; back — вернуться на своё место с нового телефона. */
type Mode = 'new' | 'manual' | 'back';
type Pick = { seatId: string; person: number } | null;

export default function JoinPreview() {
  const i = useI18n();
  const { t } = i;
  const params = useLocalSearchParams<{ code: string }>();
  const code = cleanCode(String(params.code ?? ''));
  const [pv, setPv] = useState<KassaPreview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('new');
  const [names, setNames] = useState(emptyNames());
  const [pick, setPick] = useState<Pick>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api
      .preview(code)
      .then((p) => {
        setPv(p);
        if (p.pending_reclaim) setSent(true);
        if (p.status !== 'open') setMode(p.seats.some((x) => x.members === 0) ? 'manual' : 'back');
      })
      .catch((e) => setLoadErr(i.errorText(e)));
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  const openKassa = (id: string) => {
    if (router.canDismiss()) router.dismissAll();
    router.push(`/kassa/${id}`);
  };

  if (loadErr)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 16, gap: 16 }}>
        <ErrorText text={loadErr} />
        <Button title={t('common.retry')} onPress={() => router.back()} />
      </View>
    );
  if (!pv) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  const share = pv.share_pair === pv.share_single ? i.money(pv.share_pair) : `${i.money(pv.share_pair)} / ${i.money(pv.share_single)}`;
  const manualSeats = pv.seats.filter((x) => x.members === 0);
  // Для возврата: каждый человек на месте — отдельная строка (в паре можно вернуть и первого, и второго).
  const people = pv.seats
    .filter((x) => x.members > 0)
    .flatMap((x) =>
      x.kind === 'pair' && x.names && x.names.length === 2
        ? x.names.map((n, idx) => ({ seatId: x.id, person: idx, title: n, sub: x.name }))
        : [{ seatId: x.id, person: 0, title: x.name, sub: '' }],
    );
  const options: { value: Mode; label: string }[] = [
    ...(pv.status === 'open' ? [{ value: 'new' as Mode, label: t('join.newSeat') }] : []),
    ...(manualSeats.length ? [{ value: 'manual' as Mode, label: t('join.manualSeat') }] : []),
    { value: 'back', label: t('join.back') },
  ];

  const submit = async () => {
    setErr(null);
    if (mode === 'new') {
      const ne = namesError(names);
      if (ne) return setErr(t(`err.${ne}`));
    } else if (!pick) return;
    setBusy(true);
    try {
      if (mode === 'back') {
        await api.requestReclaim(code, pick!.seatId, pick!.person);
        setSent(true);
      } else {
        const id = await api.join(
          code,
          mode === 'new'
            ? { name: seatLabel(names, t('common.and')), names: namesArray(names), kind: names.kind }
            : { seatId: pick!.seatId },
        );
        openKassa(id);
      }
    } catch (e) {
      setErr(i.errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const Radio = ({ on }: { on: boolean }) => (
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? C.accent : C.line, alignItems: 'center', justifyContent: 'center' }}>
      {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} /> : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Label>{t('join.code')} · {code}</Label>
          <Text style={{ color: C.fg, ...F.display, fontSize: 24 }}>{pv.title}</Text>
          <T muted>{t('join.shareLine', { share })}</T>
          {pv.target_size ? <T muted>{t('join.seatsCount', { a: pv.seat_count, b: pv.target_size })}</T> : null}
        </Card>

        {pv.already_member ? (
          <>
            <Hint>{t('join.already')}</Hint>
            <Button kind="primary" title={t('join.open')} onPress={() => openKassa(pv.id)} />
          </>
        ) : sent ? (
          <Card tone="invite">
            <SectionTitle text={t('reclaim.sentTitle')} />
            <T>{t('reclaim.sent')}</T>
            <Button title={t('reclaim.toHome')} onPress={() => router.replace('/')} />
          </Card>
        ) : (
          <>
            {options.length > 1 ? (
              <Segmented
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setPick(null);
                  setErr(null);
                }}
                options={options}
              />
            ) : null}
            {pv.status !== 'open' && mode !== 'back' ? <Hint>{t('join.drawnHint')}</Hint> : null}

            {mode === 'new' ? <NamesFields value={names} onChange={setNames} /> : null}

            {mode === 'manual' ? (
              <View>
                <Hint>{t('join.manualHint')}</Hint>
                {manualSeats.map((x, idx) => {
                  const on = pick?.seatId === x.id;
                  return (
                    <Pressable key={x.id} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => setPick({ seatId: x.id, person: 0 })}>
                      <Row last={idx === manualSeats.length - 1}>
                        <Avatar name={x.name} />
                        <View style={{ flex: 1 }}>
                          <T style={{ ...F.bodySemi }}>{x.name}</T>
                          <T muted style={{ fontSize: 13 }}>{t('join.freeManual')}</T>
                        </View>
                        <Radio on={on} />
                      </Row>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {mode === 'back' ? (
              <View>
                <Hint>{t('reclaim.hint')}</Hint>
                {people.map((x, idx) => {
                  const on = pick?.seatId === x.seatId && pick.person === x.person;
                  return (
                    <Pressable
                      key={`${x.seatId}-${x.person}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      onPress={() => setPick({ seatId: x.seatId, person: x.person })}
                    >
                      <Row last={idx === people.length - 1}>
                        <Avatar name={x.title} />
                        <View style={{ flex: 1 }}>
                          <T style={{ ...F.bodySemi }}>{x.title}</T>
                          {x.sub ? <T muted style={{ fontSize: 13 }}>{x.sub}</T> : null}
                        </View>
                        <Radio on={on} />
                      </Row>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <ErrorText text={err} />
            <Button
              kind="primary"
              title={mode === 'back' ? t('reclaim.ask') : t('join.submit')}
              onPress={submit}
              loading={busy}
              disabled={mode !== 'new' && !pick}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SectionTitle({ text }: { text: string }) {
  return <Text style={{ color: C.fg, ...F.displayMed, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 }}>{text}</Text>;
}
