"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useImportWizard } from "@/components/lots/import/useImportWizard";
import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";
import { StepIndicator } from "@/components/lots/import/StepIndicator";
import { Step1Paste } from "@/components/lots/import/Step1Paste";
import { Step2Preview } from "@/components/lots/import/Step2Preview";
import { Step3Metadata } from "@/components/lots/import/Step3Metadata";
import {
  SubmittingPanel,
  DonePanel,
  ErrorPanel,
} from "@/components/lots/import/StatusPanels";

/**
 * /lots/import — 3-step wizard:
 *   Step 1: paste box (host:port / host:port:user:pass / CSV / TSV)
 *   Step 2: preview parsed rows + per-row errors
 *   Step 3: lot metadata (vendor_label, dates, cost, batch ref)
 *   Done:   summary + link to /lots/[id]
 *
 * Idempotency: useImportWizard generates a UUIDv7 once per wizard
 * session — re-submitting the same key returns the existing lot
 * (handled by the import_lot RPC).
 */
export default function LotImportPage() {
  const w = useImportWizard();
  const validCount = useMemo(
    () => w.state.parsedRows.filter((r) => !r.error).length,
    [w.state.parsedRows],
  );
  const errorCount = w.state.parsedRows.length - validCount;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Link href="/lots">
          <Button variant="outline" size="icon-sm">
            <ArrowLeft />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Import lot</h1>
          <p className="text-sm text-muted-foreground">
            Paste the CSV or TXT you got from the vendor portal. We&rsquo;ll create one
            purchase lot + N proxies in a single transaction.
          </p>
        </div>
      </div>

      <StepIndicator current={w.state.step} />

      {w.state.step === "paste" && <Step1Paste w={w} />}
      {w.state.step === "parsed" && (
        <Step2Preview
          w={w}
          validCount={validCount}
          errorCount={errorCount}
        />
      )}
      {w.state.step === "metadata" && <Step3Metadata w={w} validCount={validCount} />}
      {w.state.step === "submitting" && <SubmittingPanel />}
      {w.state.step === "done" && w.state.result && <DonePanel result={w.state.result} reset={w.reset} />}
      {w.state.step === "error" && <ErrorPanel message={w.state.errorMessage} reset={w.reset} />}
    </div>
  );
}
