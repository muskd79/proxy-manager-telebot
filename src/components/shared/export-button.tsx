"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ExportButtonProps<T> {
  data: T[];
  filename: string;
  className?: string;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function toCSV<T>(data: T[]): string {
  if (data.length === 0) return "";
  const headers = Object.keys(data[0] as Record<string, unknown>);
  const rows = data.map((row) =>
    headers
      .map((header) => {
        const value = String((row as Record<string, unknown>)[header] ?? "");
        // Escape double quotes and wrap in quotes if contains comma, quote, or newline
        if (value.includes(",") || value.includes('"') || value.includes("\n")) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

export function ExportButton<T>({
  data,
  filename,
  className,
}: ExportButtonProps<T>) {
  const handleExportCSV = () => {
    const csv = toCSV(data);
    downloadFile(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
  };

  const handleExportJSON = () => {
    const json = JSON.stringify(data, null, 2);
    downloadFile(json, `${filename}.json`, "application/json");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className={className} />}
      >
        <Download className="mr-2 h-4 w-4" />
        Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleExportCSV}>
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportJSON}>
          Export as JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
