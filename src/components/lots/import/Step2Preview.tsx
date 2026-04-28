"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { WizardApi } from "@/components/lots/import/useImportWizard";

interface Step2PreviewProps {
  w: WizardApi;
  validCount: number;
  errorCount: number;
}

export function Step2Preview({ w, validCount, errorCount }: Step2PreviewProps) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Badge variant="default">{validCount} valid</Badge>
          {errorCount > 0 && <Badge variant="destructive">{errorCount} errors</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={w.parsePaste}>
          Re-parse
        </Button>
      </div>

      <div className="max-h-[400px] overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Host</TableHead>
              <TableHead>Port</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Pass</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {w.state.parsedRows.slice(0, 200).map((r) => (
              <TableRow key={r.line} className={r.error ? "bg-destructive/5" : undefined}>
                <TableCell className="text-xs text-muted-foreground">{r.line}</TableCell>
                <TableCell className="font-mono text-xs">{r.host}</TableCell>
                <TableCell className="font-mono text-xs">{r.port || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{maskMaybe(r.username)}</TableCell>
                <TableCell className="font-mono text-xs">{maskMaybe(r.password)}</TableCell>
                <TableCell>
                  {r.error ? (
                    <Badge variant="destructive" className="text-xs">{r.error}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">ok</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {w.state.parsedRows.length > 200 && (
          <div className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Showing first 200 of {w.state.parsedRows.length} rows. All rows will be imported.
          </div>
        )}
      </div>

      <div className="flex justify-between">
        {/* Wave 22E-2 BUG FIX (B8): pre-fix code called setPasteText with the
            current text — a no-op self-set. Now uses the BACK_TO_PASTE
            reducer action which actually flips the wizard step. */}
        <Button variant="outline" onClick={w.backToPaste}>
          <ArrowLeft /> Back to paste
        </Button>
        <Button onClick={w.goToMetadata} disabled={validCount === 0}>
          Continue <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function maskMaybe(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "****" + s.slice(-2);
}
