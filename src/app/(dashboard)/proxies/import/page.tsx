"use client";

import { ProxyImport } from "@/components/proxies/proxy-import";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function ProxiesImportPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" render={<Link href="/proxies" />}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Import Proxies</h1>
          <p className="text-muted-foreground">
            Bulk import proxies from TXT or CSV files
          </p>
        </div>
      </div>

      <ProxyImport />
    </div>
  );
}
