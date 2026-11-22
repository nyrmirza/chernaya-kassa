import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { ApiError } from './api';
import { resetPush } from './push';
import { ensureSession, supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export type Provider = 'apple' | 'google';

export interface AccountInfo {
  anonymous: boolean;
  providers: Provider[];
  email: string | null;
}

/** Куда Supabase вернёт пользователя после входа. Добавьте этот адрес в Supabase → Auth → URL Configuration. */
export const redirectTo = Linking.createURL('auth-callback');

async function finishInBrowser(url: string) {
  const res = await WebBrowser.openAuthSessionAsync(url, redirectTo);
  if (res.type !== 'success') throw new ApiError('AUTH_CANCELLED');
  const { queryParams } = Linking.parse(res.url);
  const q = (queryParams ?? {}) as Record<string, string | undefined>;
  if (q.error_code === 'identity_already_exists' || /already linked|already exists/i.test(q.error_description ?? '')) {
    throw new ApiError('IDENTITY_TAKEN');
  }
  if (q.error || q.error_code) throw new ApiError('AUTH_FAILED');
  if (!q.code) throw new ApiError('AUTH_FAILED');
  const { error } = await supabase.auth.exchangeCodeForSession(q.code);
  if (error) throw new ApiError('AUTH_FAILED');
}

/**
 * Сохранить текущий аккаунт: привязать Apple или Google к анонимному входу.
 * Все кассы остаются — меняется только способ входа.
 */
export async function linkAccount(provider: Provider) {
  const { data, error } = await supabase.auth.linkIdentity({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw new ApiError(error?.message?.includes('manual linking') ? 'LINKING_DISABLED' : 'AUTH_FAILED');
  await finishInBrowser(data.url);
}

/** Войти в уже сохранённый аккаунт (новый телефон). Текущий анонимный вход заменяется. */
export async function signInWith(provider: Provider) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error || !data?.url) throw new ApiError('AUTH_FAILED');
  await finishInBrowser(data.url);
  resetPush();
}

/** Выйти и начать заново с анонимным входом. */
export async function signOut() {
  await supabase.auth.signOut().catch(() => {});
  await ensureSession();
  resetPush();
}

export async function accountInfo(): Promise<AccountInfo> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  const providers = (u?.identities ?? [])
    .map((x) => x.provider)
    .filter((p): p is Provider => p === 'apple' || p === 'google');
  return { anonymous: !!u?.is_anonymous && providers.length === 0, providers, email: u?.email ?? null };
}
