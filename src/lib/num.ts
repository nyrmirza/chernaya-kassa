/** Личный код для супруга — 8 символов. */
export const cleanToken = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
/** Код демо-кассы: создаёт личную демо-кассу с примерами. */
export const DEMO_CODE = 'DEMKAS';
export const cleanCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
export const digits = (v: string) => v.replace(/\D/g, '').slice(0, 9);
/** «50000» → «50 000» для полей ввода сумм. */
export const groupDigits = (v: string) => digits(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Достать код из чего угодно: «KZ7D3Q», ссылки …/j/KZ7D3Q или …/p/ABCD2345, chernayakassa://join/KZ7D3Q
 * или всего текста приглашения из WhatsApp.
 */
export function extractCode(text: string): string {
  const t = text.toUpperCase();
  const link = t.match(/\/(?:J|P|JOIN)\/([A-HJ-NP-Z2-9]{6,8})\b/);
  if (link) return link[1];
  const labelled = t.match(/(?:КОД|CODE|КОДЫ)[^A-Z0-9]{0,6}([A-HJ-NP-Z2-9]{6,8})\b/);
  if (labelled) return labelled[1];
  return cleanToken(text);
}
