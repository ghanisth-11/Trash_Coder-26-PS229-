'use client';

import { createContext, useContext } from 'react';
import { AppLanguage, translate } from '@/lib/i18n';

const TranslationContext = createContext<AppLanguage>('en');

export function TranslationProvider({
  language,
  children,
}: {
  language: AppLanguage;
  children: React.ReactNode;
}) {
  return <TranslationContext.Provider value={language}>{children}</TranslationContext.Provider>;
}

export function useTranslation() {
  const language = useContext(TranslationContext);
  return (key: string) => translate(language, key);
}
