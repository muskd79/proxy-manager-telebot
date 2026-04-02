"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
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
  fetchAllUrl?: string; // If provided, fetch all data from this URL before export
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

async function fetchAllData<T>(fetchAllUrl: string): Promise<T[]> {
  const separator = fetchAllUrl.includes("?") ? "&" : "?";
  const url = `${fetchAllUrl}${separator}pageSize=100000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch all data for export");
  const json = await res.json();
  // Support both { data: [...] } and { data: { items: [...] } } shapes
  if (Array.isArray(json.data)) return json.data;
  if (json.data?.items && Array.isArray(json.data.items)) return json.data.items;
  if (json.data?.data && Array.isArray(json.data.data)) return json.data.data;
  return [];
}

export function ExportButton<T>({
  data,
  filename,
  className,
  fetchAllUrl,
}: ExportButtonProps<T>) {
  const [loading, setLoading] = useState(false);

  const getExportData = async (): Promise<T[]> => {
    if (!fetchAllUrl) return data;
    setLoading(true);
    try {
      return await fetchAllData<T>(fetchAllUrl);
    } catch {
      // Fallback to current page data on error
      return data;
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    const exportData = await getExportData();
    const csv = toCSV(exportData);
    downloadFile(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
  };

  const handleExportJSON = async () => {
    const exportData = await getExportData();
    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, `${filename}.json`, "application/json");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className={className} disabled={loading} />}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        {loading ? "Loading..." : "Export"}
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
