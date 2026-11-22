import { Platform } from 'react-native';

export type ThemeMode = 'system' | 'dark' | 'light';
export type Scheme = 'dark' | 'light';

// Тёмная «касса»: графит, латунь, зелёный «сдал», красный Kaspi.
const DARK = {
  bg: '#141413',
  surface: '#1d1c1a',
  surface2: '#24231f',
  line: '#2e2c28',
  fg: '#efe9dd',
  muted: '#9b9486',
  placeholder: '#6a655b',
  accent: '#d9a441',
  accentInk: '#1b1408',
  ok: '#6fbf8a',
  danger: '#e07a62',
  kaspi: '#e5574b',
  okBg: 'rgba(111,191,138,0.15)',
  kaspiBg: 'rgba(229,87,75,0.14)',
  accentSoft: 'rgba(217,164,65,0.16)',
  accentStrong: 'rgba(217,164,65,0.22)',
  barIdle: 'rgba(239,233,221,0.06)',
  secretBorder: '#5a2c27',
  inviteBorder: '#6b5223',
};

// Светлая: тёплая бумага, та же латунь потемнее, чтобы читалась на светлом.
const LIGHT: typeof DARK = {
  bg: '#f3f0e8',
  surface: '#fbf9f4',
  surface2: '#efe9dd',
  line: '#ddd6c7',
  fg: '#1d1b17',
  muted: '#6e675a',
  placeholder: '#a39b8b',
  accent: '#a8761a',
  accentInk: '#fffaf0',
  ok: '#2f8550',
  danger: '#b8472e',
  kaspi: '#c4372c',
  okBg: 'rgba(47,133,80,0.12)',
  kaspiBg: 'rgba(196,55,44,0.10)',
  accentSoft: 'rgba(168,118,26,0.12)',
  accentStrong: 'rgba(168,118,26,0.20)',
  barIdle: 'rgba(29,27,23,0.05)',
  secretBorder: '#e5b9b0',
  inviteBorder: '#e2cc9c',
};

/** Текущая палитра. Меняется целиком при смене темы (см. applyScheme). */
export const C: typeof DARK = { ...DARK };
export let scheme: Scheme = 'dark';

const listeners: (() => void)[] = [];
/** Модули со StyleSheet.create регистрируют пересборку стилей под новую тему. */
export function onTheme(fn: () => void) {
  listeners.push(fn);
}

export function applyScheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  Object.assign(C, next === 'dark' ? DARK : LIGHT);
  listeners.forEach((fn) => fn());
}

// Системный шрифт iPhone (SF Pro): в нём есть весь казахский алфавит (Ә Ғ Қ Ң Ө Ұ Ү Һ І).
// На Android — системный Roboto (тоже с казахскими буквами), поэтому fontFamily не задаём.
// Каждый стиль — объект { fontFamily, fontWeight }, подставляется через ...F.xxx.
type Face = { fontFamily?: string; fontWeight: '400' | '500' | '600' | '700' | '800' | '900' };
const sys = (w: Face['fontWeight']): Face => (Platform.OS === 'ios' ? { fontFamily: 'System', fontWeight: w } : { fontWeight: w });
export const F = {
  display: sys('900'),
  displayMed: sys('700'),
  body: sys('400'),
  bodySemi: sys('600'),
  bodyBold: sys('700'),
  mono: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string },
};

export const R = { sm: 9, md: 12, lg: 14, xl: 18, pill: 999 };
