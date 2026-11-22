import { router } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Button, ErrorText, Field, Hint } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';
import { startDemo as makeDemo } from '../../src/lib/demo';
import { DEMO_CODE, extractCode } from '../../src/lib/num';
import { C, F } from '../../src/theme';

export default function JoinCode() {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const i = useI18n();

  const startDemo = async () => {
    try {
      const id = await makeDemo(i.lang);
      if (router.canDismiss()) router.dismissAll();
      router.push(`/kassa/${id}`);
    } catch (e) {
      setErr(i.errorText(e));
    }
  };

  const go = () => {
    if (code === DEMO_CODE) return startDemo();
    // 6 символов — код кассы, 8 — личный код от супруга.
    if (code.length === 8) return router.push({ pathname: '/p/[token]', params: { token: code } });
    if (code.length !== 6) return setErr(t('err.KASSA_NOT_FOUND'));
    router.push({ pathname: '/join/[code]', params: { code } });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: C.fg, ...F.display, fontSize: 24 }}>{t('join.title')}</Text>
        <Field
          label={t('join.code')}
          value={code}
          onChangeText={(v) => {
            setCode(extractCode(v));
            setErr(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          placeholder="KZ7D3Q"
          returnKeyType="go"
          onSubmitEditing={go}
          style={{ flex: 0 }}
        />
        <Hint>{t('join.codeHint')}</Hint>
        <Hint>{t('demo.hint', { code: DEMO_CODE })}</Hint>
        <ErrorText text={err} />
        <Button kind="primary" title={t('join.find')} onPress={go} disabled={code.length !== 6 && code.length !== 8} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
