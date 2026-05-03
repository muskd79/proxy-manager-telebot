"use client";

/**
 * Wave 26-D-2 — warranty claim table.
 *
 * Single-table render of warranty_claims with joined proxy + user
 * data. Mirror of the request-table pattern (cells, sort headers,
 * actions) but tuned to the warranty workflow:
 *   - status pill maps to Vietnamese (Đang đợi / Đã duyệt / Bị từ chối)
 *   - reason badge with friendly Vietnamese
 *   - proxy host:port linked to /proxies/[id]
 *   - user link to /users/[id]
 *   - "Có thay thế" pill if replacement_proxy_id set
 *   - Action column: pending → "Duyệt" + "Từ chối" buttons; resolved
 *     → "Xem chi tiết" only
 */

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  ExternalLink,
  ShieldQuestion,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeWithTitle } from "@/lib/format-time";
import type {
  WarrantyClaim,
  WarrantyClaimStatus,
  WarrantyReasonCode,
  Proxy,
} from "@/types/database";

export interface WarrantyClaimRow extends WarrantyClaim {
  proxy?: Pick<
    Proxy,
    "id" | "host" | "port" | "type" | "status" | "category_id" | "network_type" | "country"
  > | null;
  user?: {
    id: string;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
  } | null;
  replacement?: Pick<Proxy, "id" | "host" | "port" | "type"> | null;
  resolved_by_admin?: {
    id: string;
    email: string;
    full_name: string | null;
  } | null;
}

const STATUS_LABEL: Record<WarrantyClaimStatus, string> = {
  pending: "Đang đợi",
  approved: "Đã duyệt",
  rejected: "Bị từ chối",
};

const STATUS_VARIANT: Record<
  WarrantyClaimStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "default",
  approved: "secondary",
  rejected: "destructive",
};

const REASON_LABEL: Record<WarrantyReasonCode, string> = {
  no_connect: "Không kết nối",
  slow: "Chậm",
  ip_blocked: "IP bị block",
  wrong_country: "Sai quốc gia",
  auth_fail: "Sai user/pass",
  other: "Khác",
};

interface WarrantyTableProps {
  claims: WarrantyClaimRow[];
  isLoading: boolean;
  canWrite: boolean;
  onApprove: (claim: WarrantyClaimRow) => void;
  onReject: (claim: WarrantyClaimRow) => void;
}

function userLabel(u: WarrantyClaimRow["user"]): string {
  if (!u) return "—";
  if (u.username) return `@${u.username}`;
  if (u.first_name) return u.first_name;
  return String(u.telegram_id);
}

export function WarrantyTable({
  claims,
  isLoading,
  canWrite,
  onApprove,
  onReject,
}: WarrantyTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table aria-label="Danh sách bảo hành">
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Proxy</TableHead>
              <TableHead className="w-32">Lý do</TableHead>
              <TableHead className="w-28">Trạng thái</TableHead>
              <TableHead className="w-40">Tạo lúc</TableHead>
              <TableHead className="w-44">Proxy thay thế</TableHead>
              <TableHead className="w-44">Admin xử lý</TableHead>
              {canWrite && (
                <TableHead className="w-44 text-right">Hành động</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={`s-${i}`}>
                  {Array.from({ length: canWrite ? 8 : 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : claims.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canWrite ? 8 : 7}
                  className="py-12 text-center"
                >
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ShieldQuestion className="size-8 opacity-30" aria-hidden="true" />
                    <p className="text-sm font-medium">Không có claim nào</p>
                    <p className="text-xs">
                      Claim sẽ xuất hiện ở đây khi user báo lỗi proxy qua bot.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              claims.map((claim) => {
                const created = formatRelativeWithTitle(claim.created_at);
                const resolved = claim.resolved_at
                  ? formatRelativeWithTitle(claim.resolved_at)
                  : null;
                return (
                  <TableRow key={claim.id}>
                    <TableCell>
                      {claim.user ? (
                        <Link
                          href={`/users/${claim.user.id}`}
                          className="text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {userLabel(claim.user)}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {claim.proxy ? (
                        <Link
                          href={`/proxies/${claim.proxy.id}`}
                          className="inline-flex items-center gap-1 font-mono text-sm text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {claim.proxy.host}:{claim.proxy.port}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Badge variant="outline" className="text-xs w-fit">
                          {REASON_LABEL[claim.reason_code]}
                        </Badge>
                        {claim.reason_text && (
                          <p
                            className="line-clamp-2 max-w-[12rem] text-[11px] text-muted-foreground"
                            title={claim.reason_text}
                          >
                            {claim.reason_text}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANT[claim.status]}
                        className={cn(
                          claim.status === "pending" &&
                            "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
                        )}
                      >
                        {STATUS_LABEL[claim.status]}
                      </Badge>
                      {claim.status === "rejected" && claim.rejection_reason && (
                        <p
                          className="mt-0.5 line-clamp-2 max-w-[10rem] text-[11px] text-muted-foreground"
                          title={claim.rejection_reason}
                        >
                          {claim.rejection_reason}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      <span title={created.absolute}>{created.relative}</span>
                    </TableCell>
                    <TableCell>
                      {claim.replacement ? (
                        <Link
                          href={`/proxies/${claim.replacement.id}`}
                          className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {claim.replacement.host}:{claim.replacement.port}
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </Link>
                      ) : claim.status === "approved" ? (
                        <Badge variant="outline" className="text-xs">
                          Hết hàng
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {claim.resolved_by_admin ? (
                        <div className="flex flex-col">
                          <span>
                            {claim.resolved_by_admin.full_name ??
                              claim.resolved_by_admin.email}
                          </span>
                          {resolved && (
                            <span
                              className="text-[11px] text-muted-foreground"
                              title={resolved.absolute}
                            >
                              {resolved.relative}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Chưa</span>
                      )}
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        {claim.status === "pending" ? (
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => onApprove(claim)}
                              className="gap-1"
                            >
                              <CheckCircle2 className="size-3.5" />
                              Duyệt
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => onReject(claim)}
                              className="gap-1"
                            >
                              <XCircle className="size-3.5" />
                              Từ chối
                            </Button>
                          </div>
                        ) : (
                          <Link
                            href={`/proxies/${claim.proxy_id}`}
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Xem proxy →
                          </Link>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
