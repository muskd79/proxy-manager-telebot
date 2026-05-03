"use client";

/**
 * Wave 26-D-pre1 (gap D1, synthesis from multi-agent brainstorm 2026-05-03).
 *
 * Right-rail metadata for the storyteller-layout proxy detail page.
 *
 * Pre-fix (288-line monolith), all metadata was buried in a 4×2 grid
 * inside a "Proxy Info" card mixed with English labels. User feedback:
 * "trang chi tiết proxy phải hiện FULL tất cả mọi thứ". Brainstormer
 * agent pushed: timeline = primary view, metadata in a secondary rail.
 *
 * Sections (top → bottom):
 *   1. Kết nối       host, port, type, network_type, country/city, expires_at
 *   2. Phân loại      category (link), import batch (link)
 *   3. Mua bán        vendor, purchase_date, cost, sale price, lợi nhuận (with margin %)
 *   4. Phân phối      distribute_count, last_distributed_at, assigned_to
 *   5. Ẩn / Cờ        hidden toggle (admin only), is_deleted indicator
 *   6. Hệ thống       created_at, created_by, updated_at
 *
 * Mobile: rail collapses into an accordion ABOVE the timeline, default
 * open on the first section.
 *
 * Wave 26-D (later) will add `reliability_score` (proxies row column)
 * — a 7th section "Độ tin cậy" with a 0-100 progress bar.
 */

import Link from "next/link";
import {
  Globe,
  Folder,
  Package,
  Wallet,
  TrendingUp,
  TrendingDown,
  Users,
  EyeOff,
  Server,
  Clock,
  ExternalLink,
} from "lucide-react";
import type { Proxy } from "@/types/database";
import { networkTypeLabel, type NetworkType } from "@/lib/proxy-labels";
import { formatRelativeWithTitle } from "@/lib/format-time";
import { CredentialCell } from "@/components/proxies/credential-cell";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface MetadataRailProps {
  proxy: Proxy;
  /** Maps category_id → display name for the "Phân loại" link. */
  categoryName?: string | null;
  /** When admin toggles hidden field — provided by parent. */
  onToggleHidden?: (next: boolean) => Promise<void>;
  /** Whether the current admin can write (toggles, edit). */
  canWrite: boolean;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 py-3 first:pt-0 last:pb-0">
      <header className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        <span>{title}</span>
      </header>
      <dl className="space-y-1.5 text-sm">{children}</dl>
    </section>
  );
}

function Field({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: React.ReactNode;
  emphasis?: "ok" | "warn" | "fail";
}) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-0.5">
      <dt className="text-xs text-muted-foreground pt-0.5">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words text-sm",
          emphasis === "ok" && "font-medium text-emerald-600 dark:text-emerald-400",
          emphasis === "warn" && "font-medium text-amber-600 dark:text-amber-400",
          emphasis === "fail" && "font-medium text-red-600 dark:text-red-400",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function formatUSD(v: number | null | undefined): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export function MetadataRail({
  proxy,
  categoryName,
  canWrite,
}: MetadataRailProps) {
  // Profit calculation. Mirror the bulk-edit margin logic so the rail
  // never disagrees with the table. cost or sale missing → "—" (not 0,
  // which is meaningful — could be a free / give-away proxy).
  const cost = proxy.cost_usd;
  const sale = proxy.sale_price_usd;
  const profit = cost != null && sale != null ? sale - cost : null;
  const profitPct = profit != null && cost != null && cost > 0
    ? Math.round((profit / cost) * 100)
    : null;
  const profitTone: "ok" | "warn" | "fail" =
    profit == null ? "ok" : profit > 0 ? "ok" : profit === 0 ? "warn" : "fail";

  const expiresMeta = formatRelativeWithTitle(proxy.expires_at);
  const lastDistributedMeta = formatRelativeWithTitle(proxy.last_distributed_at);
  const assignedAtMeta = formatRelativeWithTitle(proxy.assigned_at);
  const createdMeta = formatRelativeWithTitle(proxy.created_at);
  const updatedMeta = formatRelativeWithTitle(proxy.updated_at);

  return (
    <aside
      className="rounded-lg border bg-card divide-y divide-border/60 px-4"
      aria-label="Thông tin chi tiết proxy"
    >
      {/* ─── 1. Kết nối ─── */}
      <Section title="Kết nối" icon={Server}>
        <Field label="Host:Cổng">
          <code className="font-mono text-sm select-all">
            {proxy.host}:{proxy.port}
          </code>
        </Field>
        <Field label="Giao thức">
          <Badge variant="outline" className="text-xs uppercase">
            {proxy.type}
          </Badge>
        </Field>
        <Field label="Loại mạng">
          {proxy.network_type ? (
            <Badge variant="outline" className="text-xs">
              {networkTypeLabel(proxy.network_type as NetworkType)}
            </Badge>
          ) : (
            <span className="text-muted-foreground">Chưa phân loại</span>
          )}
        </Field>
        <Field label="Username">
          <CredentialCell value={proxy.username} kind="username" />
        </Field>
        <Field label="Mật khẩu">
          {/* Wave 26-D-pre1 (gap D2=b) — proxy detail mặc định REVEAL
              mật khẩu (admin đã vào tới detail → trust level cao).
              CredentialCell vẫn cho phép ẩn lại nếu admin muốn share
              màn với người khác qua screen-share. */}
          <CredentialCell value={proxy.password} kind="password" />
        </Field>
        <Field label="Quốc gia">
          {proxy.country ? (
            <span className="inline-flex items-center gap-1">
              <Globe className="size-3.5 text-muted-foreground" aria-hidden="true" />
              {proxy.country}
              {proxy.city && (
                <span className="text-muted-foreground">/ {proxy.city}</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">Không rõ</span>
          )}
        </Field>
        <Field label="Hết hạn">
          {proxy.expires_at ? (
            <span title={expiresMeta.absolute}>
              {formatDate(proxy.expires_at)}
              <span className="ml-1 text-xs text-muted-foreground">
                ({expiresMeta.relative})
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Vĩnh viễn</span>
          )}
        </Field>
      </Section>

      {/* ─── 2. Phân loại ─── */}
      <Section title="Phân loại" icon={Folder}>
        <Field label="Danh mục">
          {proxy.category_id ? (
            <Link
              href={`/proxies?category_id=${proxy.category_id}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
            >
              {categoryName ?? "Mở danh mục"}
              <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          ) : (
            <span className="text-muted-foreground">Chưa phân loại</span>
          )}
        </Field>
        <Field label="Lô import">
          {proxy.import_batch_id ? (
            <Link
              href={`/proxies?import_batch_id=${proxy.import_batch_id}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
            >
              <Package className="size-3" aria-hidden="true" />
              <code className="font-mono text-xs">
                {proxy.import_batch_id.slice(0, 8)}…
              </code>
              <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          ) : (
            <span className="text-muted-foreground">Tạo thủ công</span>
          )}
        </Field>
      </Section>

      {/* ─── 3. Mua bán ─── */}
      <Section title="Mua bán" icon={Wallet}>
        <Field label="Nguồn">
          {proxy.vendor_label ?? <span className="text-muted-foreground">—</span>}
        </Field>
        <Field label="Ngày mua">{formatDate(proxy.purchase_date)}</Field>
        <Field label="Giá mua">{formatUSD(cost)}</Field>
        <Field label="Giá bán">{formatUSD(sale)}</Field>
        <Field label="Lợi nhuận" emphasis={profitTone}>
          {profit == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="inline-flex items-center gap-1">
              {profit > 0 && (
                <TrendingUp className="size-3.5" aria-hidden="true" />
              )}
              {profit < 0 && (
                <TrendingDown className="size-3.5" aria-hidden="true" />
              )}
              {formatUSD(profit)}
              {profitPct != null && (
                <span className="text-xs">({profitPct >= 0 ? "+" : ""}{profitPct}%)</span>
              )}
            </span>
          )}
        </Field>
      </Section>

      {/* ─── 4. Phân phối ─── */}
      <Section title="Phân phối" icon={Users}>
        <Field label="Đã giao">
          <span className="font-medium tabular-nums">{proxy.distribute_count ?? 0}</span>
          <span className="ml-1 text-xs text-muted-foreground">lần</span>
        </Field>
        <Field label="Lần cuối">
          {proxy.last_distributed_at ? (
            <span title={lastDistributedMeta.absolute}>
              {lastDistributedMeta.relative}
            </span>
          ) : (
            <span className="text-muted-foreground">Chưa từng</span>
          )}
        </Field>
        <Field label="Đang giao cho">
          {proxy.assigned_to ? (
            <Link
              href={`/users/${proxy.assigned_to}`}
              className="inline-flex items-center gap-1 text-blue-600 hover:underline dark:text-blue-400"
            >
              Xem user
              <ExternalLink className="size-3" aria-hidden="true" />
            </Link>
          ) : (
            <span className="text-muted-foreground">Chưa giao</span>
          )}
        </Field>
        <Field label="Thời gian giao">
          {proxy.assigned_at ? (
            <span title={assignedAtMeta.absolute}>{assignedAtMeta.relative}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Field>
      </Section>

      {/* ─── 5. Cờ ─── */}
      <Section title="Cờ" icon={EyeOff}>
        <Field label="Đã ẩn">
          {proxy.hidden ? (
            <Badge variant="outline" className="text-xs">
              Đang ẩn khỏi danh sách
            </Badge>
          ) : (
            <span className="text-muted-foreground">Không</span>
          )}
        </Field>
        <Field label="Thùng rác">
          {proxy.is_deleted ? (
            <Badge variant="destructive" className="text-xs">
              Đã xoá mềm
            </Badge>
          ) : (
            <span className="text-muted-foreground">Không</span>
          )}
        </Field>
        {!canWrite && (
          <p className="text-xs text-muted-foreground">
            Bạn không có quyền chỉnh sửa cờ trên proxy này.
          </p>
        )}
      </Section>

      {/* ─── 6. Hệ thống ─── */}
      <Section title="Hệ thống" icon={Clock}>
        <Field label="Tạo lúc">
          <span title={createdMeta.absolute}>{createdMeta.relative}</span>
        </Field>
        <Field label="Người tạo">
          {proxy.created_by ? (
            <code className="font-mono text-xs select-all">
              {proxy.created_by.slice(0, 8)}…
            </code>
          ) : (
            <span className="text-muted-foreground">Hệ thống</span>
          )}
        </Field>
        <Field label="Cập nhật">
          <span title={updatedMeta.absolute}>{updatedMeta.relative}</span>
        </Field>
      </Section>
    </aside>
  );
}
