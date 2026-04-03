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
          <h1 className="text-2xl font-bold tracking-tight">Trash</h1>
          <p className="text-muted-foreground">
            Manage soft-deleted items. Items are permanently removed after 30
            days.
          </p>
        </div>
      </div>

      {/* Auto-clean info */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
        <CardContent className="flex items-center gap-3 py-3">
          <AlertTriangle className="size-5 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Items in trash are automatically permanently deleted after 30 days.
            Restore items before then to keep them.
          </p>
        </CardContent>
      </Card>

      <Tabs defaultValue="proxies">
        <TabsList>
          <TabsTrigger value="proxies">Proxies</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="requests">Requests</TabsTrigger>
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
