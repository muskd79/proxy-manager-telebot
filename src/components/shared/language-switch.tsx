"use client";

import { useCallback, useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Locale = "vi" | "en";

const LOCALE_KEY = "proxy-manager-locale";

const localeLabels: Record<Locale, string> = {
  vi: "Tieng Viet",
  en: "English",
};

export function LanguageSwitch() {
  const [locale, setLocale] = useState<Locale>("vi");

  useEffect(() => {
    const stored = localStorage.getItem(LOCALE_KEY) as Locale | null;
    if (stored && (stored === "vi" || stored === "en")) {
      setLocale(stored);
    }
  }, []);

  const handleChange = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    localStorage.setItem(LOCALE_KEY, newLocale);
    document.cookie = `${LOCALE_KEY}=${newLocale};path=/;max-age=31536000`;
    // Optionally trigger a page reload or i18n context update
    window.dispatchEvent(new CustomEvent("locale-change", { detail: newLocale }));
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" />}
      >
        <Languages className="h-4 w-4" />
        <span className="text-xs font-medium uppercase">{locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleChange("vi")}>
          {localeLabels.vi}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleChange("en")}>
          {localeLabels.en}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
