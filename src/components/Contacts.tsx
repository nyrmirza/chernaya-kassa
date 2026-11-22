import React from 'react';
import { Alert, Linking, View } from 'react-native';
import { useI18n } from '../i18n';
import { openStoreReview } from '../lib/review';
import { Button, Card, Hint, SectionHead } from './ui';

// Контакты для идей и сотрудничества.
export const CONTACT_WHATSAPP = '77477887572'; // +7 747 788 75 72
export const CONTACT_EMAIL = 'nurbakytuly@gmail.com';

export function Contacts() {
  const { t } = useI18n();

  const open = async (url: string, fallback: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('app.name'), fallback);
    }
  };

  const subject = t('contacts.subject');

  return (
    <Card>
      <SectionHead title={t('contacts.title')} />
      <Hint>{t('contacts.hint')}</Hint>
      <View style={{ gap: 8, marginTop: 4 }}>
        <Button
          title={t('contacts.whatsapp')}
          onPress={() =>
            open(`https://wa.me/${CONTACT_WHATSAPP}?text=${encodeURIComponent(subject + ': ')}`, '+7 747 788 75 72')
          }
        />
        <Button kind="primary" title={t('contacts.rate')} onPress={openStoreReview} />
        <Button
          title={t('contacts.email')}
          onPress={() => open(`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`, CONTACT_EMAIL)}
        />
      </View>
    </Card>
  );
}
