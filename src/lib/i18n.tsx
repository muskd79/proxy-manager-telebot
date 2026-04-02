"use client";

import { createContext, useContext, useState, useEffect } from "react";
import viMessages from "@/locales/vi.json";
import enMessages from "@/locales/en.json";

type Locale = "vi" | "en";
const messages: Record<Locale, Record<string, unknown>> = { vi: viMessages, en: enMessages };

function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return path; // fallback to key
    }
  }
  return typeof current === "string" ? current : path;
}

export function t(key: string, locale: Locale = "vi"): string {
  return getNestedValue(messages[locale] as Record<string, unknown>, key);
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
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
