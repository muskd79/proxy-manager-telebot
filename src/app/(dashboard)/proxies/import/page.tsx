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
          <h1 className="text-2xl font-bold tracking-tight">Dán / Import proxy</h1>
          <p className="text-muted-foreground">
            Dán tới 1000 dòng <code className="rounded bg-muted px-1 text-xs">host:port</code>{" "}
            hoặc <code className="rounded bg-muted px-1 text-xs">host:port:user:pass</code>,
            hoặc upload file TXT/CSV. Hệ thống sẽ tự kiểm tra trước khi
            thêm vào kho.
          </p>
        </div>
      </div>

      <ProxyImport />
    </div>
  );
}
