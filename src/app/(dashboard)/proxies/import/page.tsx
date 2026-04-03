"use client";

import { ProxyImport } from "@/components/proxies/proxy-import";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function ProxiesImportPage() {
  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center gap-4">
        <Link href="/proxies" className={buttonVariants({ variant: "ghost", size: "icon" })}>
          <ArrowLeft className="size-4" />
        </Link>
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
