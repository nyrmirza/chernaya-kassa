import React from 'react';
import { View } from 'react-native';
import { useI18n } from '../i18n';
import { SeatKind } from '../lib/api';
import { Field, Label, Segmented } from './ui';

export interface NamesValue {
  kind: SeatKind;
  first: string;
  second: string;
}

export const emptyNames = (kind: SeatKind = 'pair'): NamesValue => ({ kind, first: '', second: '' });

/** Имена для сервера: [одиночка] или [первый, второй]. */
export const namesArray = (v: NamesValue) => (v.kind === 'pair' ? [v.first.trim(), v.second.trim()] : [v.first.trim()]);

/** Название места: «Дамир и Света» / «Тимур». */
export const seatLabel = (v: NamesValue, and: string) =>
  v.kind === 'pair' ? `${v.first.trim()} ${and} ${v.second.trim()}` : v.first.trim();

/** Ошибка заполнения или null. */
export function namesError(v: NamesValue): 'NAME_REQUIRED' | 'PARTNER_NAME_REQUIRED' | null {
  if (!v.first.trim()) return 'NAME_REQUIRED';
  if (v.kind === 'pair' && !v.second.trim()) return 'PARTNER_NAME_REQUIRED';
  return null;
}

/** Выбор «Пара / Один» и поля имён. `self` — вводит ли человек себя (иначе — организатор вписывает другого). */
export function NamesFields({ value, onChange, self = true }: { value: NamesValue; onChange: (v: NamesValue) => void; self?: boolean }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 6 }}>
        <Label>{t('create.who')}</Label>
        <Segmented
          value={value.kind}
          onChange={(kind) => onChange({ ...value, kind })}
          options={[
            { value: 'pair', label: t('common.pair') },
            { value: 'single', label: t('common.single') },
          ]}
        />
      </View>
      {value.kind === 'pair' ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field
            label={self ? t('names.mine') : t('names.first')}
            placeholder={t('names.firstPh')}
            value={value.first}
            onChangeText={(first) => onChange({ ...value, first })}
            maxLength={30}
          />
          <Field
            label={self ? t('names.spouse') : t('names.second')}
            placeholder={t('names.secondPh')}
            value={value.second}
            onChangeText={(second) => onChange({ ...value, second })}
            maxLength={30}
          />
        </View>
      ) : (
        <Field
          label={self ? t('names.mine') : t('names.single')}
          placeholder={t('join.namePh')}
          value={value.first}
          onChangeText={(first) => onChange({ ...value, first })}
          maxLength={30}
          style={{ flex: 0 }}
        />
      )}
    </View>
  );
}
