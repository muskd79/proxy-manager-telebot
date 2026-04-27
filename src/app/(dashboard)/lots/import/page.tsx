"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useImportWizard } from "@/components/lots/import/useImportWizard";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { useMemo } from "react";

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

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

function Step1Paste({ w }: { w: ReturnType<typeof useImportWizard> }) {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <Label htmlFor="paste">Paste proxies</Label>
      <Textarea
        id="paste"
        rows={14}
        value={w.state.pasteText}
        onChange={(e) => w.setPasteText(e.target.value)}
        placeholder={[
          "203.0.113.1:8080",
          "203.0.113.2:8080:user:pass",
          "203.0.113.3,8080,user,pass",
          "203.0.113.4\t8080\tuser\tpass",
        ].join("\n")}
        className="font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Supported: <code>host:port</code>, <code>host:port:user:pass</code>,
        comma-delimited, tab-delimited. Headers auto-skipped.
      </p>
      <div className="flex justify-end">
        <Button onClick={w.parsePaste} disabled={!w.state.pasteText.trim()}>
          Preview <ArrowRight />
        </Button>
      </div>
    </div>
  );
}

function Step2Preview({
  w,
  validCount,
  errorCount,
}: {
  w: ReturnType<typeof useImportWizard>;
  validCount: number;
  errorCount: number;
}) {
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

function Step3Metadata({
  w,
  validCount,
}: {
  w: ReturnType<typeof useImportWizard>;
  validCount: number;
}) {
  const m = w.state.metadata;
  const canSubmit = m.vendor_label.trim().length > 0;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="vendor">Vendor *</Label>
          <Input
            id="vendor"
            value={m.vendor_label}
            onChange={(e) => w.setMetadata({ vendor_label: e.target.value })}
            placeholder="e.g. Proxy-Seller"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="batch">Vendor order # (optional)</Label>
          <Input
            id="batch"
            value={m.batch_reference}
            onChange={(e) => w.setMetadata({ batch_reference: e.target.value })}
            placeholder="PS-12345"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="purchase">Purchase date</Label>
          <Input
            id="purchase"
            type="date"
            value={m.purchase_date}
            onChange={(e) => w.setMetadata({ purchase_date: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="expiry">Expiry date *</Label>
          <Input
            id="expiry"
            type="date"
            value={m.expiry_date}
            onChange={(e) => w.setMetadata({ expiry_date: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cost">Total cost</Label>
          <Input
            id="cost"
            type="number"
            step="0.01"
            min="0"
            value={m.total_cost_usd}
            onChange={(e) => w.setMetadata({ total_cost_usd: e.target.value })}
            placeholder="85.00"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="currency">Currency</Label>
          <Input
            id="currency"
            maxLength={3}
            value={m.currency}
            onChange={(e) => w.setMetadata({ currency: e.target.value.toUpperCase() })}
            placeholder="USD"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <Input
            id="notes"
            value={m.notes}
            onChange={(e) => w.setMetadata({ notes: e.target.value })}
            placeholder="Anything that helps you remember this lot"
          />
        </div>
      </div>

      <div className="rounded-md bg-muted/30 p-3 text-sm">
        Importing <strong>{validCount}</strong> proxies under{" "}
        <strong>{m.vendor_label || "(no vendor)"}</strong>
        {m.expiry_date && (
          <>
            {" "}
            expiring <strong>{m.expiry_date}</strong>
          </>
        )}
        {m.total_cost_usd && (
          <>
            {" "}
            for <strong>${m.total_cost_usd}</strong>
          </>
        )}
        .
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={w.backToParsed}>
          <ArrowLeft /> Back
        </Button>
        <Button onClick={w.submit} disabled={!canSubmit}>
          <Upload /> Confirm import
        </Button>
      </div>
    </div>
  );
}

function SubmittingPanel() {
  return (
    <div className="rounded-lg border p-10 text-center">
      <Loader2 className="mx-auto animate-spin" />
      <p className="mt-2 text-sm text-muted-foreground">Importing lot…</p>
    </div>
  );
}

function DonePanel({
  result,
  reset,
}: {
  result: { lot_id: string; inserted: number; updated: number; deduplicated: boolean };
  reset: () => void;
}) {
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

function ErrorPanel({ message, reset }: { message: string | null; reset: () => void }) {
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

function StepIndicator({ current }: { current: string }) {
  const steps = [
    { id: "paste", label: "1 · Paste" },
    { id: "parsed", label: "2 · Preview" },
    { id: "metadata", label: "3 · Lot info" },
    { id: "done", label: "Done" },
  ];
  return (
    <div className="flex items-center gap-2 text-sm">
      {steps.map((s, i) => {
        const active = current === s.id;
        const past = stepRank(current) > i;
        return (
          <div
            key={s.id}
            className={
              active
                ? "rounded-md bg-primary px-2.5 py-1 text-primary-foreground"
                : past
                  ? "rounded-md bg-muted px-2.5 py-1 text-foreground"
                  : "rounded-md px-2.5 py-1 text-muted-foreground"
            }
          >
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

function stepRank(step: string): number {
  const order = ["paste", "parsed", "metadata", "submitting", "done", "error"];
  return order.indexOf(step);
}

function maskMaybe(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.length <= 4) return "****";
  return s.slice(0, 2) + "****" + s.slice(-2);
}
