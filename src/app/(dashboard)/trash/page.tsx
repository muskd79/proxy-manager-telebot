"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";
import { TrashProxies } from "@/components/trash/trash-proxies";
import { TrashUsers } from "@/components/trash/trash-users";
import { TrashRequests } from "@/components/trash/trash-requests";
import { useRole } from "@/lib/role-context";

export default function TrashPage() {
  const { canWrite } = useRole();

  return (
    <div className="flex-1 space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Thùng rác</h1>
          <p className="text-muted-foreground">
            Quản lý các mục đã xoá mềm. Các mục sẽ bị xoá vĩnh viễn sau 30
            ngày.
          </p>
        </div>
      </div>

      {/* Auto-clean info */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardContent className="flex items-center gap-3 py-3">
          <AlertTriangle className="size-5 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Các mục trong thùng rác sẽ tự động bị xoá vĩnh viễn sau 30 ngày.
            Hãy khôi phục trước đó nếu muốn giữ lại.
          </p>
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
