import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { C, F, R, onTheme } from '../theme';

export function T({ style, mono, muted, ...p }: React.ComponentProps<typeof Text> & { mono?: boolean; muted?: boolean }) {
  return <Text {...p} style={[s.text, muted && { color: C.muted }, mono && s.mono, style]} />;
}

export function Label({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function SectionHead({ title, right }: { title: string; right?: string }) {
  return (
    <View style={s.sechead}>
      <Text style={s.sectitle}>{title}</Text>
      {right ? <Text style={s.small}>{right}</Text> : null}
    </View>
  );
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'secret' | 'invite' }) {
  return (
    <View
      style={[
        s.card,
        tone === 'secret' && { borderColor: C.secretBorder },
        tone === 'invite' && { borderColor: C.inviteBorder },
        style,
      ]}
    >
      {children}
    </View>
  );
}

type BtnKind = 'primary' | 'ghost' | 'danger';
export function Button({
  title,
  onPress,
  kind = 'ghost',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress?: () => unknown;
  kind?: BtnKind;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      disabled={off}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        s.btn,
        kind === 'primary' && s.btnPrimary,
        kind === 'danger' && s.btnDanger,
        pressed && { opacity: 0.75 },
        off && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? C.accentInk : C.fg} />
      ) : (
        <Text style={[s.btnText, kind === 'primary' && { color: C.accentInk }, kind === 'danger' && { color: C.danger }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Кнопка копирования: меняет подпись на «Скопировано». */
export function CopyButton({ title, doneTitle, text, kind = 'ghost', style }: { title: string; doneTitle: string; text: () => string; kind?: BtnKind; style?: StyleProp<ViewStyle> }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      kind={kind}
      style={style}
      title={done ? doneTitle : title}
      onPress={async () => {
        await Clipboard.setStringAsync(text());
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    />
  );
}

export function Field({ label, style, ...p }: Omit<TextInputProps, 'style'> & { label: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap: 6, flex: 1 }, style]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={C.placeholder} selectionColor={C.accent} {...p} style={[s.input, p.editable === false && { opacity: 0.6 }]} />
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <View style={s.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(o.value);
            }}
            style={[s.segItem, on && s.segOn]}
          >
            <Text numberOfLines={1} adjustsFontSizeToFit style={[s.segText, on && { color: C.accentInk }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

type PillTone = 'ok' | 'wait' | 'now' | 'kaspi' | 'admin';
export function Pill({ text, tone }: { text: string; tone: PillTone }) {
  const map: Record<PillTone, { bg: string; fg: string; border?: string }> = {
    ok: { bg: C.okBg, fg: C.ok },
    wait: { bg: C.line, fg: C.muted },
    now: { bg: C.accent, fg: C.accentInk },
    kaspi: { bg: C.kaspiBg, fg: C.kaspi },
    admin: { bg: 'transparent', fg: C.accent, border: C.accent },
  };
  const m = map[tone];
  return (
    <View style={[s.pill, { backgroundColor: m.bg }, m.border ? { borderWidth: 1, borderColor: m.border } : null]}>
      <Text style={[s.pillText, { color: m.fg }]}>{text}</Text>
    </View>
  );
}

export function Avatar({ name, mono }: { name: string; mono?: boolean }) {
  return (
    <View style={s.av}>
      <Text style={[s.avText, mono && s.mono]}>{(name || '?').slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export function Row({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return <View style={[s.row, !last && s.rowLine]}>{children}</View>;
}

export function SumLine({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.sum}>
      <Text style={[s.text, { color: C.muted, flex: 1 }]}>{label}</Text>
      <Text style={[s.mono, { color: color ?? C.fg, fontSize: 15 }]}>{value}</Text>
    </View>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <Text style={s.hint}>{children}</Text>;
}

export function ErrorText({ text }: { text: string | null }) {
  if (!text) return null;
  return <Text style={s.err}>{text}</Text>;
}

const build_s = () =>
  StyleSheet.create({
  text: { color: C.fg, ...F.body, fontSize: 15, lineHeight: 21 },
  mono: { ...F.mono, fontVariant: ['tabular-nums'] },
  label: { color: C.muted, ...F.bodyBold, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  sechead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  sectitle: { color: C.fg, ...F.displayMed, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  small: { color: C.muted, ...F.body, fontSize: 13 },
  card: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: R.lg, padding: 16, gap: 12 },
  btn: { borderRadius: R.md, paddingVertical: 13, paddingHorizontal: 16, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  btnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  btnDanger: { borderColor: C.secretBorder },
  btnText: { color: C.fg, ...F.bodyBold, fontSize: 15, textAlign: 'center' },
  fieldLabel: { color: C.muted, ...F.bodySemi, fontSize: 12 },
  input: { backgroundColor: C.bg, color: C.fg, borderColor: C.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, ...F.body, fontSize: 16 },
  seg: { flexDirection: 'row', gap: 4, backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: R.md, padding: 4 },
  segItem: { flex: 1, borderRadius: R.sm, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center' },
  segOn: { backgroundColor: C.accent },
  segText: { color: C.muted, ...F.bodySemi, fontSize: 13 },
  pill: { borderRadius: R.pill, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'center' },
  pillText: { ...F.bodySemi, fontSize: 12 },
  av: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.line, alignItems: 'center', justifyContent: 'center' },
  avText: { color: C.fg, ...F.bodyBold, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowLine: { borderBottomColor: C.line, borderBottomWidth: StyleSheet.hairlineWidth },
  sum: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  hint: { color: C.muted, ...F.body, fontSize: 13, lineHeight: 18 },
  err: { color: C.danger, ...F.bodySemi, fontSize: 13 },
});

export let s = build_s();
onTheme(() => {
  s = build_s();
});
