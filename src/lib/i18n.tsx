"use client";

import { createContext, useContext, useState, useEffect } from "react";
import viMessages from "@/locales/vi.json";
import enMessages from "@/locales/en.json";

// ---------------------------------------------------------------------------
// Type-safe locale key helpers
// ---------------------------------------------------------------------------

type NestedKeys<T, Prefix extends string = ""> = T extends object
  ? {
      [K in keyof T & string]: T[K] extends object
        ? NestedKeys<T[K], `${Prefix}${K}.`>
        : `${Prefix}${K}`;
    }[keyof T & string]
  : never;

/** All valid dot-separated translation keys derived from the English locale file. */
export type TranslationKey = NestedKeys<typeof enMessages>;

export type Locale = "vi" | "en";

const messages: Record<Locale, Record<string, unknown>> = { vi: viMessages, en: enMessages };

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Translate a key with automatic fallback:
 *   1. Try the requested locale
 *   2. Fall back to English
 *   3. Fall back to the raw key itself
 */
export function t(key: TranslationKey, locale: Locale = "vi"): string {
  const translated = getNestedValue(messages[locale] as Record<string, unknown>, key);
  if (translated !== undefined) return translated;

  // Fallback to English
  const fallback = getNestedValue(messages.en as Record<string, unknown>, key);
  if (fallback !== undefined) return fallback;

  // Last resort: return the key itself
  return key;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: "vi",
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("vi");

  useEffect(() => {
    const saved = localStorage.getItem("locale") as Locale;
    if (saved === "vi" || saved === "en") setLocaleState(saved);
  }, []);

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("locale", newLocale);
    document.cookie = `locale=${newLocale};path=/;max-age=31536000`;
  };

  return (
    <I18nContext value={{ locale, setLocale, t: (key) => t(key, locale) }}>
      {children}
    </I18nContext>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
