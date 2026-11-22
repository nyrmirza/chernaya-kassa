import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { NamesFields, emptyNames, namesArray, namesError, seatLabel } from '../../components/NamesFields';
import { Avatar, Button, Card, CopyButton, ErrorText, Field, Hint, Pill, Row, SectionHead, T } from '../../components/ui';
import { useI18n } from '../../i18n';
import { KassaState, Seat, api } from '../../lib/api';
import { digits, groupDigits } from '../../lib/num';
import { inviteText, ownerName, partnerInviteText, sendToWhatsApp } from '../../lib/texts';
import { C, F } from '../../theme';
import { peopleCount } from './parts';
import { confirm } from './useKassa';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

export function PeopleTab({ st, run }: { st: KassaState; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const k = st.kassa;
  const owner = k.is_owner;
  const open = k.status === 'open';
  const others = st.seats.filter((x) => !x.is_owner && x.members > 0).length;

  return (
    <View style={{ gap: 18 }}>
      {owner ? <Reclaims st={st} run={run} /> : null}
      <PartnerInvite st={st} />
      <Invite st={st} />

      <View style={{ gap: 4 }}>
        <SectionHead title={t('people.composition')} right={t('people.counts', { seats: st.seats.length, people: peopleCount(st) })} />
        {st.seats.map((x, idx) => (
          <Row key={x.id} last={idx === st.seats.length - 1}>
            <Avatar name={x.name} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T numberOfLines={1} style={{ ...F.bodySemi }}>
                {x.name}
                {x.id === st.my_seat_id ? <Text style={{ color: C.accent }}> · {t('common.you')}</Text> : null}
              </T>
              <T muted style={{ fontSize: 13 }}>{whoIsIn(x, t)}</T>
            </View>
            {x.is_owner ? <Pill tone="admin" text={t('people.organizer')} /> : null}
            {owner && !x.is_owner ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('people.removeConfirm', { name: x.name })}
                hitSlop={10}
                onPress={async () => {
                  const msg = open ? t('people.removeConfirm', { name: x.name }) : t('people.removeAfterConfirm', { name: x.name });
                  if (await confirm(msg, t('common.yes'), t('common.cancel'), true)) run(() => api.removeSeat(k.id, x.id));
                }}
              >
                <Text style={{ color: C.muted, fontSize: 20, paddingHorizontal: 4 }}>×</Text>
              </Pressable>
            ) : null}
          </Row>
        ))}
      </View>

      {owner && k.status !== 'finished' ? <AddSeat st={st} run={run} /> : null}
      <KassaSettings st={st} run={run} />

      <View style={{ gap: 8 }}>
        {owner ? (
          <>
            {others > 0 ? <TransferOwner st={st} run={run} /> : null}
            <Button
              kind="danger"
              title={t('people.deleteKassa')}
              onPress={async () => {
                const msg =
                  others > 0
                    ? t('people.deleteKassaConfirmOthers', { title: k.title, n: others })
                    : t('people.deleteKassaConfirm', { title: k.title });
                if (await confirm(msg, t('common.yes'), t('common.cancel'), true))
                  if (await run(() => api.deleteKassa(k.id))) router.back();
              }}
            />
          </>
        ) : (
          <Button
            kind="danger"
            title={t('people.leave')}
            onPress={async () => {
              if (await confirm(t('people.leaveConfirm', { title: k.title }), t('common.yes'), t('common.cancel'), true))
                if (await run(() => api.leave(k.id))) router.back();
            }}
          />
        )}
      </View>
    </View>
  );
}

/** Передать роль организатора: список тех, кто уже вошёл в приложение (кроме себя). */
function TransferOwner({ st, run }: { st: KassaState; run: Run }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const people = st.seats.flatMap((x) =>
    (x.joined ?? [])
      .filter((p) => !(x.id === st.my_seat_id && p === (st.my_person_idx ?? 0)))
      .map((p) => ({ seat: x.id, person: p, name: x.names?.[p] || x.name })),
  );
  if (!open) return <Button title={t('owner.transfer')} onPress={() => setOpen(true)} />;
  return (
    <Card>
      <SectionHead title={t('owner.transfer')} />
      <Hint>{people.length ? t('owner.transferHint') : t('owner.transferNone')}</Hint>
      {people.map((p, idx) => (
        <Pressable
          key={`${p.seat}-${p.person}`}
          accessibilityRole="button"
          onPress={async () => {
            if (await confirm(t('owner.transferConfirm', { name: p.name }), t('common.yes'), t('common.cancel')))
              if (await run(() => api.transferOwner(st.kassa.id, p.seat, p.person))) setOpen(false);
          }}
        >
          <Row last={idx === people.length - 1}>
            <Avatar name={p.name} />
            <T style={{ flex: 1, ...F.bodySemi }}>{p.name}</T>
            <Text style={{ color: C.accent, ...F.bodyBold }}>›</Text>
          </Row>
        </Pressable>
      ))}
      <Button title={t('common.cancel')} onPress={() => setOpen(false)} />
    </Card>
  );
}

function Invite({ st }: { st: KassaState }) {
  const i = useI18n();
  const { t } = i;
  const k = st.kassa;
  const text = inviteText(i, st);
  return (
    <Card tone="invite">
      <SectionHead title={t('people.code')} right={k.is_owner ? t('people.youOrganizer') : t('people.organizerIs', { name: ownerName(st) })} />
      <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: C.accent, borderRadius: 12, paddingVertical: 14 }}>
        <Text selectable style={{ color: C.accent, ...F.mono, fontSize: 34, letterSpacing: 6, textAlign: 'center' }}>{k.code}</Text>
      </View>
      {k.is_owner ? (
        <>
          <View style={{ backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12 }}>
            <T selectable style={{ fontSize: 14 }}>{text}</T>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <CopyButton kind="primary" style={{ flex: 1 }} title={t('people.invite')} doneTitle={t('common.copied')} text={() => text} />
            <Button style={{ flex: 1 }} title={t('people.sendWa')} onPress={() => sendToWhatsApp(text)} />
          </View>
        </>
      ) : (
        <>
          <Hint>{t('people.shareCode')}</Hint>
          <CopyButton title={t('people.invite')} doneTitle={t('common.copied')} text={() => text} />
        </>
      )}
      {k.status !== 'open' ? <Hint>{t('people.drawnHint')}</Hint> : null}
    </Card>
  );
}

/** «Дамир ✓ · Света — без приложения» */
function whoIsIn(x: Seat, t: ReturnType<typeof useI18n>['t']) {
  if (x.members === 0) return `${x.kind === 'pair' ? t('common.pairPeople') : t('common.singlePeople')} · ${t('people.noApp')}`;
  if (!x.names || x.names.length === 0) return x.kind === 'pair' ? t('common.pairPeople') : t('common.singlePeople');
  return x.names.map((n, idx) => (x.joined.includes(idx) ? `${n} ✓` : `${n} — ${t('people.notYet')}`)).join(' · ');
}

function PartnerInvite({ st }: { st: KassaState }) {
  const i = useI18n();
  const { t } = i;
  const me = st.seats.find((x) => x.id === st.my_seat_id);
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!me || me.kind !== 'pair' || me.members >= 2) return null;
  const partner = me.names?.[st.my_person_idx === 0 ? 1 : 0] ?? '';

  const getText = async () => {
    let tok = token;
    if (!tok) {
      tok = await api.partnerInvite(st.kassa.id);
      setToken(tok);
    }
    return partnerInviteText(i, st, tok, partner);
  };

  return (
    <Card tone="invite">
      <SectionHead title={t('partner.title', { name: partner || t('partner.spouse') })} />
      <Hint>{t('partner.hint')}</Hint>
      {token ? (
        <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: C.accent, borderRadius: 12, paddingVertical: 10 }}>
          <Text selectable style={{ color: C.accent, ...F.mono, fontSize: 26, letterSpacing: 4, textAlign: 'center' }}>{token}</Text>
        </View>
      ) : null}
      <ErrorText text={err} />
      <Button
        kind="primary"
        loading={busy}
        title={t('partner.send')}
        onPress={async () => {
          setBusy(true);
          setErr(null);
          try {
            await sendToWhatsApp(await getText());
          } catch (e) {
            setErr(i.errorText(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </Card>
  );
}

function Reclaims({ st, run }: { st: KassaState; run: Run }) {
  const { t } = useI18n();
  if (!st.reclaims.length) return null;
  return (
    <Card tone="invite">
      <SectionHead title={t('reclaim.ownerTitle')} />
      <Hint>{t('reclaim.ownerHint')}</Hint>
      {st.reclaims.map((r) => (
        <View key={r.id} style={{ gap: 10 }}>
          <T>{t('reclaim.ownerAsk', { name: r.person_name, seat: r.seat_name })}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button kind="primary" style={{ flex: 1 }} title={t('reclaim.approve')} onPress={() => run(() => api.respondReclaim(r.id, true))} />
            <Button style={{ flex: 1 }} title={t('queue.decline')} onPress={() => run(() => api.respondReclaim(r.id, false))} />
          </View>
        </View>
      ))}
    </Card>
  );
}

function AddSeat({ st, run }: { st: KassaState; run: Run }) {
  const { t } = useI18n();
  const [names, setNames] = useState(emptyNames());
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <SectionHead title={t('people.addManual')} right={t('people.addManualSub')} />
      {st.kassa.status === 'drawn' ? <Hint>{t('people.addAfterDraw')}</Hint> : null}
      <NamesFields value={names} onChange={setNames} self={false} />
      <Button
        title={t('people.add')}
        loading={busy}
        disabled={!!namesError(names)}
        onPress={async () => {
          setBusy(true);
          if (await run(() => api.addSeat(st.kassa.id, seatLabel(names, t('common.and')), names.kind, namesArray(names))))
            setNames(emptyNames(names.kind));
          setBusy(false);
        }}
      />
    </Card>
  );
}

function KassaSettings({ st, run }: { st: KassaState; run: Run }) {
  const { t } = useI18n();
  const k = st.kassa;
  const owner = k.is_owner;
  const [title, setTitle] = useState(k.title);
  const [a, setA] = useState(groupDigits(String(k.share_pair)));
  const [b, setB] = useState(groupDigits(String(k.share_single)));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(k.title);
    setA(groupDigits(String(k.share_pair)));
    setB(groupDigits(String(k.share_single)));
  }, [k.title, k.share_pair, k.share_single]);

  const dirty = title.trim() !== k.title || Number(digits(a)) !== k.share_pair || Number(digits(b)) !== k.share_single;

  return (
    <Card>
      <SectionHead title={t('people.settings')} right={owner ? undefined : t('people.byOwner')} />
      <Field label={t('people.kassaName')} value={title} onChangeText={setTitle} editable={owner} maxLength={60} style={{ flex: 0 }} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Field label={t('create.sharePair')} value={a} onChangeText={(v) => setA(groupDigits(v))} editable={owner} keyboardType="number-pad" />
        <Field label={t('create.shareSingle')} value={b} onChangeText={(v) => setB(groupDigits(v))} editable={owner} keyboardType="number-pad" />
      </View>
      {owner && dirty ? (
        <Button
          kind="primary"
          loading={busy}
          title={t('common.save')}
          onPress={async () => {
            setBusy(true);
            await run(() => api.updateKassa(k.id, { title: title.trim(), sharePair: Number(digits(a)), shareSingle: Number(digits(b)), start: null }));
            setBusy(false);
          }}
        />
      ) : null}
    </Card>
  );
}
