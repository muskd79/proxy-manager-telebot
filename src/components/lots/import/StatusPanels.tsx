"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export function SubmittingPanel() {
  return (
    <div className="rounded-lg border p-10 text-center">
      <Loader2 className="mx-auto animate-spin" />
      <p className="mt-2 text-sm text-muted-foreground">Importing lot…</p>
    </div>
  );
}

interface DonePanelProps {
  result: { lot_id: string; inserted: number; updated: number; deduplicated: boolean };
  reset: () => void;
}

export function DonePanel({ result, reset }: DonePanelProps) {
  return (
    <div className="space-y-3 rounded-lg border p-6">
      <div className="flex items-center gap-2 text-base font-semibold">
        <CheckCircle2 className="text-green-600" />
        {result.deduplicated ? "Already imported" : "Import successful"}
      </div>
      {result.deduplicated ? (
        <p className="text-sm text-muted-foreground">
          This idempotency key was already used. The existing lot is shown below.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {result.inserted} new proxies inserted, {result.updated} updated (rebound to this lot).
        </p>
      )}
      <div className="flex gap-2">
        <Link href={`/lots/${result.lot_id}`}>
          <Button>View lot</Button>
        </Link>
        <Button variant="outline" onClick={reset}>
          Import another
        </Button>
      </div>
    </div>
  );
}

interface ErrorPanelProps {
  message: string | null;
  reset: () => void;
}

export function ErrorPanel({ message, reset }: ErrorPanelProps) {
  return (
    <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
      <div className="flex items-center gap-2 text-base font-semibold text-destructive">
        <XCircle />
        Import failed
      </div>
      <p className="text-sm text-destructive">{message ?? "Unknown error"}</p>
      <Button onClick={reset}>Start over</Button>
    </div>
  );
}
