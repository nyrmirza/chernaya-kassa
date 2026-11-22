import { Stack, router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, ErrorText, Segmented } from '../../src/components/ui';
import { useI18n } from '../../src/i18n';
import { MeetTab } from '../../src/screens/kassa/MeetTab';
import { PeopleTab } from '../../src/screens/kassa/PeopleTab';
import { PollsTab } from '../../src/screens/kassa/PollsTab';
import { QueueTab } from '../../src/screens/kassa/QueueTab';
import { Plate } from '../../src/screens/kassa/parts';
import { useKassa } from '../../src/screens/kassa/useKassa';
import { C } from '../../src/theme';

type Tab = 'meet' | 'queue' | 'polls' | 'people';

export default function KassaScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const id = String(params.id);
  const insets = useSafeAreaInsets();
  const { state, loadErr, reload, run } = useKassa(id);
  const [tab, setTab] = useState<Tab>(params.tab === 'people' || params.tab === 'queue' ? params.tab : 'meet');
  const [refreshing, setRefreshing] = useState(false);

  if (!state)
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, padding: 16, gap: 16, justifyContent: 'center' }}>
        {loadErr ? (
          <>
            <ErrorText text={loadErr} />
            <Button title={t('common.retry')} onPress={reload} />
            <Button title="←" onPress={() => router.back()} />
          </>
        ) : (
          <ActivityIndicator color={C.accent} />
        )}
      </View>
    );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: state.kassa.title }} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 40, gap: 18 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            tintColor={C.accent}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await reload();
              setRefreshing(false);
            }}
          />
        }
      >
        <Plate st={state} />
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'meet', label: t('tab.meet') },
            { value: 'queue', label: t('tab.queue') },
            { value: 'polls', label: t('tab.polls') },
            { value: 'people', label: t('tab.people') },
          ]}
        />
        {tab === 'meet' ? <MeetTab st={state} run={run} goQueue={() => setTab('queue')} /> : null}
        {tab === 'queue' ? <QueueTab st={state} run={run} /> : null}
        {tab === 'polls' ? <PollsTab st={state} run={run} /> : null}
        {tab === 'people' ? <PeopleTab st={state} run={run} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
