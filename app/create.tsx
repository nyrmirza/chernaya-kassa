import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { NamesFields, emptyNames, namesArray, namesError, seatLabel } from '../src/components/NamesFields';
import { Button, ErrorText, Field, Hint, Label } from '../src/components/ui';
import { useI18n } from '../src/i18n';
import { api } from '../src/lib/api';
import { digits, groupDigits } from '../src/lib/num';
import { C, F } from '../src/theme';

export default function Create() {
  const i = useI18n();
  const { t } = i;
  const [title, setTitle] = useState('');
  const [names, setNames] = useState(emptyNames());
  const [share, setShare] = useState('50 000');
  const [diff, setDiff] = useState(false);
  const [shareSingle, setShareSingle] = useState('50 000');
  const [size, setSize] = useState(6);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const a = Number(digits(share));
    const b = diff ? Number(digits(shareSingle)) : a;
    if (!title.trim()) return setErr(t('err.TITLE_REQUIRED'));
    const ne = namesError(names);
    if (ne) return setErr(t(`err.${ne}`));
    if (!a || !b) return setErr(t('err.BAD_SHARE'));
    setBusy(true);
    setErr(null);
    try {
      const id = await api.createKassa({
        title: title.trim(),
        name: seatLabel(names, t('common.and')),
        names: namesArray(names),
        kind: names.kind,
        sharePair: a,
        shareSingle: b,
        size,
      });
      if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: '/kassa/[id]', params: { id, tab: 'people' } });
    } catch (e) {
      setErr(i.errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: C.fg, ...F.display, fontSize: 24 }}>{t('create.title')}</Text>
        <Field label={t('create.kassaName')} placeholder={t('create.kassaNamePh')} value={title} onChangeText={setTitle} maxLength={60} autoFocus />
        <NamesFields value={names} onChange={setNames} />
        <View style={{ gap: 6 }}>
          <Label>{t('create.size')}</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.bg, borderColor: C.line, borderWidth: 1, borderRadius: 10 }}>
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setSize(Math.max(2, size - 1))} style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
              <Text style={{ color: C.accent, ...F.bodyBold, fontSize: 22 }}>−</Text>
            </Pressable>
            <Text style={{ color: C.fg, ...F.display, fontSize: 22 }}>{size}</Text>
            <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setSize(Math.min(50, size + 1))} style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
              <Text style={{ color: C.accent, ...F.bodyBold, fontSize: 22 }}>+</Text>
            </Pressable>
          </View>
          <Hint>{t('create.sizeHint')}</Hint>
        </View>
        {diff ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Field label={t('create.sharePair')} value={share} onChangeText={(v) => setShare(groupDigits(v))} keyboardType="number-pad" />
            <Field label={t('create.shareSingle')} value={shareSingle} onChangeText={(v) => setShareSingle(groupDigits(v))} keyboardType="number-pad" />
          </View>
        ) : (
          <Field label={t('create.share')} value={share} onChangeText={(v) => setShare(groupDigits(v))} keyboardType="number-pad" />
        )}
        <Pressable onPress={() => setDiff(!diff)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Switch value={diff} onValueChange={setDiff} trackColor={{ true: C.accent, false: C.line }} />
          <Text style={{ color: C.fg, ...F.body, flex: 1 }}>{t('create.differentShare')}</Text>
        </Pressable>
        <ErrorText text={err} />
        <Button kind="primary" title={t('create.submit')} onPress={submit} loading={busy} />
        <Hint>{t('create.hint')}</Hint>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
