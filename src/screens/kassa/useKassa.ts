import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useI18n } from '../../i18n';
import { KassaState, api } from '../../lib/api';
import { syncReminders } from '../../lib/reminders';

const POLL_MS = 15000;

export function useKassa(id: string) {
  const i = useI18n();
  const [state, setState] = useState<KassaState | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const s = await api.getKassa(id);
      if (alive.current) {
        setState(s);
        setLoadErr(null);
      }
      syncReminders(s, i);
    } catch (e) {
      if (alive.current) setLoadErr(i.errorText(e));
    }
  }, [id, i]);

  // Пока экран открыт — подтягиваем изменения других участников.
  useFocusEffect(
    useCallback(() => {
      alive.current = true;
      reload();
      const timer = setInterval(reload, POLL_MS);
      return () => {
        alive.current = false;
        clearInterval(timer);
      };
    }, [reload]),
  );

  /** Выполнить действие и обновить состояние; ошибку показываем системным алертом. */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await reload();
        return true;
      } catch (e) {
        Alert.alert(i.t('app.name'), i.errorText(e));
        await reload();
        return false;
      }
    },
    [i, reload],
  );

  return { state, loadErr, reload, run };
}

/** Подтверждение через системный алерт. */
export function confirm(title: string, yes: string, cancel: string, destructive = false): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, undefined, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: yes, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]),
  );
}
