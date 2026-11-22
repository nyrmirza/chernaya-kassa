import React, { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { Button, Card, ErrorText, Field, Hint, Pill, SectionHead, T } from '../../components/ui';
import { useI18n } from '../../i18n';
import { KassaState, Poll, api } from '../../lib/api';
import { pollText, sendToWhatsApp } from '../../lib/texts';
import { C, F } from '../../theme';
import { confirm } from './useKassa';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

export function PollsTab({ st, run }: { st: KassaState; run: Run }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 18 }}>
      <NewPoll st={st} run={run} />
      {st.polls.length === 0 ? <Hint>{t('polls.empty')}</Hint> : null}
      {st.polls.map((p) => (
        <PollCard key={p.id} st={st} p={p} run={run} />
      ))}
    </View>
  );
}

function NewPoll({ st, run }: { st: KassaState; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState<string[]>(['', '']);
  const [multi, setMulti] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return <Button kind="primary" title={t('polls.new')} onPress={() => setOpen(true)} />;

  const submit = async () => {
    const clean = opts.map((o) => o.trim()).filter(Boolean);
    if (!q.trim()) return setErr(t('err.QUESTION_REQUIRED'));
    if (clean.length < 2) return setErr(t('err.NEED_2_OPTIONS'));
    setErr(null);
    setBusy(true);
    const ok = await run(() => api.createPoll(st.kassa.id, q.trim(), clean, multi));
    setBusy(false);
    if (ok) {
      setQ('');
      setOpts(['', '']);
      setMulti(false);
      setOpen(false);
    }
  };

  return (
    <Card>
      <SectionHead title={t('polls.new')} />
      <Field label={t('polls.question')} placeholder={t('polls.questionPh')} value={q} onChangeText={setQ} maxLength={200} style={{ flex: 0 }} autoFocus />
      {opts.map((o, idx) => (
        <View key={idx} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <Field
            label={t('polls.option', { n: idx + 1 })}
            value={o}
            maxLength={100}
            onChangeText={(v) => setOpts(opts.map((x, j) => (j === idx ? v : x)))}
          />
          {opts.length > 2 ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpts(opts.filter((_, j) => j !== idx))} style={{ paddingBottom: 12 }}>
              <Text style={{ color: C.muted, fontSize: 20 }}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {opts.length < 10 ? (
        <Pressable accessibilityRole="button" onPress={() => setOpts([...opts, ''])} hitSlop={6}>
          <Text style={{ color: C.accent, ...F.bodyBold }}>{t('polls.addOption')}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => setMulti(!multi)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Switch value={multi} onValueChange={setMulti} trackColor={{ true: C.accent, false: C.line }} />
        <Text style={{ color: C.fg, ...F.body, flex: 1 }}>{t('polls.multi')}</Text>
      </Pressable>
      <ErrorText text={err} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button style={{ flex: 1 }} title={t('common.cancel')} onPress={() => setOpen(false)} />
        <Button style={{ flex: 1 }} kind="primary" title={t('polls.create')} loading={busy} onPress={submit} />
      </View>
    </Card>
  );
}

function PollCard({ st, p, run }: { st: KassaState; p: Poll; run: Run }) {
  const i = useI18n();
  const { t } = i;
  const max = Math.max(1, ...p.options.map((o) => o.votes));
  const total = p.options.reduce((a, o) => a + o.votes, 0);

  const vote = (optionId: string) => {
    if (p.closed) return;
    const mine = p.options.filter((o) => o.mine).map((o) => o.id);
    let next: string[];
    if (p.multi) next = mine.includes(optionId) ? mine.filter((x) => x !== optionId) : [...mine, optionId];
    else next = mine.includes(optionId) ? [] : [optionId];
    run(() => api.votePoll(p.id, next));
  };

  return (
    <Card>
      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Text style={{ flex: 1, color: C.fg, ...F.bodyBold, fontSize: 17, lineHeight: 22 }}>{p.question}</Text>
          {p.closed ? <Pill tone="wait" text={t('polls.closed')} /> : null}
        </View>
        <T muted style={{ fontSize: 13 }}>
          {p.author ? `${t('polls.by', { name: p.author })} · ` : ''}
          {t('polls.voters', { a: p.voters, b: st.seats.length })}
        </T>
      </View>

      <View style={{ gap: 8 }}>
        {p.options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          return (
            <Pressable
              key={o.id}
              accessibilityRole={p.multi ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: o.mine, disabled: p.closed }}
              disabled={p.closed}
              onPress={() => vote(o.id)}
              style={{ borderWidth: 1, borderColor: o.mine ? C.accent : C.line, borderRadius: 10, overflow: 'hidden', backgroundColor: C.bg }}
            >
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${(o.votes / max) * 100}%`,
                  backgroundColor: o.mine ? C.accentStrong : C.barIdle,
                }}
              />
              <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, color: C.fg, ...(o.mine ? F.bodyBold : F.bodySemi), fontSize: 15 }}>
                    {o.mine ? '✓ ' : ''}
                    {o.text}
                  </Text>
                  <Text style={{ color: C.muted, ...F.mono, fontSize: 13 }}>
                    {o.votes} · {pct}%
                  </Text>
                </View>
                {o.names.length ? (
                  <Text numberOfLines={2} style={{ color: C.muted, ...F.body, fontSize: 12 }}>
                    {o.names.join(', ')}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      {!p.closed ? <Hint>{t('polls.oneVote')}</Hint> : null}

      <View style={{ gap: 8 }}>
        {!p.closed ? <Button title={t('polls.share')} onPress={() => sendToWhatsApp(pollText(i, st, p))} /> : null}
        {p.can_manage && !p.closed ? (
          <Button
            title={t('polls.close')}
            onPress={async () => {
              if (await confirm(t('polls.closeConfirm'), t('common.yes'), t('common.cancel'))) run(() => api.closePoll(p.id));
            }}
          />
        ) : null}
        {p.can_manage ? (
          <Button
            kind="danger"
            title={t('polls.delete')}
            onPress={async () => {
              if (await confirm(t('polls.deleteConfirm'), t('common.yes'), t('common.cancel'), true)) run(() => api.deletePoll(p.id));
            }}
          />
        ) : null}
      </View>
    </Card>
  );
}
