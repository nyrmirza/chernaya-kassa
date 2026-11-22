import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { cleanCode } from '../../src/lib/num';

// https://chernaya-kassa-kz.web.app/j/КОД (Universal Link) → экран входа с подставленным кодом.
export default function JoinLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={{ pathname: '/join/[code]', params: { code: cleanCode(String(code ?? '')) } }} />;
}
