"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { TrashProxies } from "@/components/trash/trash-proxies";
import { TrashUsers } from "@/components/trash/trash-users";
import { TrashRequests } from "@/components/trash/trash-requests";
import { useRole } from "@/lib/role-context";
import { ProxySubTabs } from "@/components/proxies/proxy-sub-tabs";

export default function TrashPage() {
  const { canWrite } = useRole();

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Wave 22T — sub-tab of Quản lý proxy. */}
      <ProxySubTabs />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Thùng rác</h1>
          <p className="text-sm text-muted-foreground">
            Quản lý các mục đã xoá mềm — proxy, người dùng và yêu cầu. Mỗi
            mục được giữ lại 30 ngày trước khi hệ thống xoá vĩnh viễn.
          </p>
        </div>
      </div>

      {/* Auto-clean info banner — Wave 26-D-pre2: stronger color contrast
          + clearer copy. Each individual row now also shows a per-row
          "Tự xoá sau" countdown badge so admin can scan rows about to
          expire without reading this banner again. */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardContent className="flex items-start gap-3 py-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <div className="text-sm text-amber-800 dark:text-amber-300">
            <p className="font-medium">Tự động xoá vĩnh viễn sau 30 ngày</p>
            <p className="text-xs text-amber-700/90 dark:text-amber-400/80">
              Mỗi dòng có cột{" "}
              <span className="font-medium">Tự xoá sau</span>{" "}
              hiển thị thời gian còn lại — màu đỏ là sắp hết hạn.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="proxies">
        <TabsList>
          <TabsTrigger value="proxies">Proxy</TabsTrigger>
          <TabsTrigger value="users">Người dùng</TabsTrigger>
          <TabsTrigger value="requests">Yêu cầu</TabsTrigger>
        </TabsList>
        <TabsContent value="proxies">
          <TrashProxies canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="users">
          <TrashUsers canWrite={canWrite} />
        </TabsContent>
        <TabsContent value="requests">
          <TrashRequests canWrite={canWrite} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
