"use client";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";

const localeLabels: Record<"vi" | "en", string> = {
  vi: "Tiếng Việt",
  en: "English",
};

export function LanguageSwitch() {
  const { locale, setLocale } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" />}
      >
        <Languages className="h-4 w-4" />
        <span className="text-xs font-medium uppercase">{locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setLocale("vi")}>
          {localeLabels.vi}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLocale("en")}>
          {localeLabels.en}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
