import { Redirect } from 'expo-router';
import React from 'react';

// Сюда iOS может открыть приложение после входа через Apple / Google. Сам вход завершает src/lib/auth.ts.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
