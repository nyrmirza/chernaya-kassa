import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Button, Card, ErrorText, Hint, Label, T } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';
import { PartnerPreview, api } from '../../src/lib/api';
import { cleanToken } from '../../src/lib/num';
import { C, F } from '../../src/theme';

// https://chernaya-kassa-kz.web.app/p/ТОКЕН — личная ссылка для второго из пары.
export default function PartnerJoin() {
  const i = useI18n();
  const { t } = i;
  const token = cleanToken(String(useLocalSearchParams<{ token: string }>().token ?? ''));
  const [pv, setPv] = useState<PartnerPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.partnerPreview(token).then(setPv).catch((e) => setErr(i.errorText(e)));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string) => {
    if (router.canDismiss()) router.dismissAll();
    router.replace(`/kassa/${id}`);
  };

  if (err && !pv)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 16, gap: 16 }}>
        <ErrorText text={err} />
        <Button title={t('common.retry')} onPress={() => router.replace('/')} />
      </View>
    );
  if (!pv) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card tone="invite">
        <Label>{t('partner.label')}</Label>
        <Text style={{ color: C.fg, ...F.display, fontSize: 24 }}>{pv.title}</Text>
        <T>{t('partner.body', { partner: pv.partner_name || pv.seat_name, me: pv.my_name || '—' })}</T>
      </Card>
      {pv.already_member ? (
        <>
          <Hint>{t('join.already')}</Hint>
          <Button kind="primary" title={t('join.open')} onPress={() => open(pv.kassa_id)} />
        </>
      ) : pv.full ? (
        <Hint>{t('err.PARTNER_ALREADY_IN')}</Hint>
      ) : (
        <>
          <ErrorText text={err} />
          <Button
            kind="primary"
            loading={busy}
            title={t('partner.join', { me: pv.my_name || t('common.you') })}
            onPress={async () => {
              setBusy(true);
              setErr(null);
              try {
                open(await api.joinPartner(token));
              } catch (e) {
                setErr(i.errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      )}
    </ScrollView>
  );
}
