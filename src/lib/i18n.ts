import viMessages from "@/locales/vi.json";
import enMessages from "@/locales/en.json";

export type Locale = "vi" | "en";

type Messages = typeof viMessages;

const messages: Record<Locale, Messages> = {
  vi: viMessages,
  en: enMessages,
};

/**
 * Get a translation value by dot-separated key path.
 * Falls back to the key itself if the path is not found.
 */
export function t(key: string, locale: Locale = "vi"): string {
  const parts = key.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let current: any = messages[locale];

  for (const part of parts) {
    if (current === undefined || current === null) return key;
    current = current[part];
  }

  return typeof current === "string" ? current : key;
}

/**
 * React hook for translations.
 * Returns a translate function bound to the given locale.
 */
export function useTranslation(locale: Locale = "vi") {
  return {
    t: (key: string) => t(key, locale),
    locale,
  };
}
