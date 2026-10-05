import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { en, type Translations } from './en';
import { ml } from './ml';

export type Language = 'en' | 'ml';

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const STORAGE_KEY = 'marklist_lang';

const dictionaries: Record<Language, Translations> = { en, ml };

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof current === 'string' ? current : undefined;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'ml') return saved;
    } catch {
      /* ignore storage errors */
    }
    return 'en';
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* ignore storage errors */
    }
  };

  useEffect(() => {
    // Keep html lang attribute in sync
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: string, params?: Record<string, string | number>): string => {
    const dict = dictionaries[language] ?? en;
    let template = getNestedValue(dict as unknown as Record<string, unknown>, key);
    if (!template && language !== 'en') {
      template = getNestedValue(en as unknown as Record<string, unknown>, key);
    }
    if (!template) {
      return key;
    }

    if (params) {
      return template.replace(/\{(\w+)\}/g, (_, pName: string) => {
        return pName in params ? String(params[pName]) : `{${pName}}`;
      });
    }

    return template;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within a LanguageProvider');
  }
  return ctx;
}
