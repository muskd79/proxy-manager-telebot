"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight } from "lucide-react";
import type { WizardApi } from "@/components/lots/import/useImportWizard";

interface Step1PasteProps {
  w: WizardApi;
}

export function Step1Paste({ w }: Step1PasteProps) {
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
