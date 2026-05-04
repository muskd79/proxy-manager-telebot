"use client";

/**
 * Wave 27 UX-3 — canonical empty-state component for list pages.
 *
 * Two flavors via the `mode` prop (UX audit recommendation):
 *   - "filter-empty" — filters applied, zero results. Offer
 *     "Xoá hết bộ lọc" CTA.
 *   - "zero-data" — no rows exist yet (fresh install / cleared
 *     trash). Offer entity-specific creation CTA.
 *
 * The legacy free-form prop interface (icon + title + description
 * + action) still works — pass any of those manually to override
 * the preset. Adoption can be incremental: existing callers keep
 * working until they want the canonical preset.
 *
 * Pre-fix audit: 4 pages had inline `<div className="rounded-lg
 * border border-dashed bg-card p-8 text-center">…` blocks with
 * different copy + missing CTAs. Now: 1 component, consistent
 * Vietnamese, consistent layout.
 */

import { FileX, FolderPlus, SearchX, ShieldQuestion, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";

type EntityKey = "proxies" | "categories" | "requests" | "warranty" | "users" | "logs";

interface PresetSpec {
  /** Icon shown in the zero-data empty state. */
  icon: React.ComponentType<{ className?: string }>;
  /** Vietnamese title for zero-data state. */
  zeroTitle: string;
  /** Vietnamese description for zero-data state. */
  zeroDescription: string;
  /** Vietnamese CTA label for zero-data state, optional. */
  zeroCtaLabel?: string;
  /** Vietnamese title for filter-empty state. */
  filterTitle: string;
  /** Vietnamese description for filter-empty state. */
  filterDescription: string;
}

const PRESETS: Record<EntityKey, PresetSpec> = {
  proxies: {
    icon: FileX,
    zeroTitle: "Chưa có proxy nào",
    zeroDescription:
      "Thêm proxy thủ công hoặc dùng wizard import CSV để bắt đầu.",
    zeroCtaLabel: "+ Thêm proxy",
    filterTitle: "Không có proxy khớp bộ lọc",
    filterDescription: "Thử bỏ bớt tiêu chí hoặc đổi khoảng thời gian.",
  },
  categories: {
    icon: FolderPlus,
    zeroTitle: "Chưa có danh mục nào",
    zeroDescription:
      "Tạo danh mục để phân loại proxy theo loại, vùng, hoặc nhà cung cấp. Khi thêm proxy vào danh mục, các giá trị mặc định sẽ tự động được điền.",
    zeroCtaLabel: "+ Tạo danh mục đầu tiên",
    filterTitle: "Không có danh mục khớp bộ lọc",
    filterDescription:
      "Thử bỏ bớt tiêu chí hoặc bật chế độ \"Bao gồm danh mục đã ẩn\".",
  },
  requests: {
    icon: FileX,
    zeroTitle: "Chưa có yêu cầu nào",
    zeroDescription:
      "Khi user gửi /getproxy qua bot, yêu cầu sẽ xuất hiện ở đây để admin duyệt.",
    filterTitle: "Không có yêu cầu khớp bộ lọc",
    filterDescription: "Thử đổi tab trạng thái hoặc bỏ bớt tiêu chí.",
  },
  warranty: {
    icon: ShieldQuestion,
    zeroTitle: "Chưa có yêu cầu bảo hành",
    zeroDescription:
      "Khi user báo lỗi proxy qua bot, yêu cầu bảo hành sẽ xuất hiện ở đây.",
    filterTitle: "Không có yêu cầu bảo hành khớp bộ lọc",
    filterDescription: "Thử đổi tab trạng thái hoặc bỏ bớt tiêu chí.",
  },
  users: {
    icon: UsersRound,
    zeroTitle: "Chưa có user nào",
    zeroDescription:
      "User sẽ được tạo tự động khi gõ /start trên bot Telegram.",
    filterTitle: "Không có user khớp bộ lọc",
    filterDescription: "Thử đổi tab trạng thái hoặc tìm kiếm.",
  },
  logs: {
    icon: FileX,
    zeroTitle: "Chưa có hoạt động nào",
    zeroDescription: "Khi có thao tác trên hệ thống, log sẽ xuất hiện ở đây.",
    filterTitle: "Không có log khớp bộ lọc",
    filterDescription: "Thử đổi khoảng thời gian hoặc bỏ bớt tiêu chí.",
  },
};

interface EmptyStateProps {
  /** Canonical preset entity. When set, drives icon + title + description. */
  entity?: EntityKey;
  /** Empty-state flavor. Required when `entity` is set. */
  mode?: "filter-empty" | "zero-data";
  /** Free-form icon override. Falls back to preset icon when omitted. */
  icon?: React.ReactNode;
  /** Free-form title override. Falls back to preset title when omitted. */
  title?: string;
  /** Free-form description override. */
  description?: string;
  /** Action element (button) — fully custom. */
  action?: React.ReactNode;
  /**
   * Convenience: clear-filters callback. When `mode === "filter-empty"`
   * AND this is provided, renders an "Xoá hết bộ lọc" outline button
   * automatically.
   */
  onClearFilters?: () => void;
  /**
   * Convenience: zero-data CTA callback. When `mode === "zero-data"`
   * AND this is provided, renders the preset's CTA button
   * (e.g., "+ Tạo danh mục đầu tiên") automatically.
   */
  onCreate?: () => void;
}

export function EmptyState({
  entity,
  mode,
  icon,
  title,
  description,
  action,
  onClearFilters,
  onCreate,
}: EmptyStateProps) {
  // Resolve preset (if entity set) and fall back to free-form props.
  const preset = entity ? PRESETS[entity] : null;
  const isFilter = mode === "filter-empty";

  const ResolvedIcon =
    icon ??
    (preset ? (
      isFilter ? (
        <SearchX className="h-10 w-10" aria-hidden="true" />
      ) : (
        <preset.icon className="h-10 w-10" aria-hidden="true" />
      )
    ) : null);

  const resolvedTitle =
    title ?? (preset ? (isFilter ? preset.filterTitle : preset.zeroTitle) : "");

  const resolvedDescription =
    description ??
    (preset
      ? isFilter
        ? preset.filterDescription
        : preset.zeroDescription
      : undefined);

  // Default action — derived from callbacks + preset.
  const resolvedAction =
    action ??
    (() => {
      if (isFilter && onClearFilters) {
        return (
          <Button variant="outline" onClick={onClearFilters}>
            Xoá hết bộ lọc
          </Button>
        );
      }
      if (!isFilter && onCreate && preset?.zeroCtaLabel) {
        return (
          <Button onClick={onCreate} className="bg-orange-500 hover:bg-orange-600">
            {preset.zeroCtaLabel}
          </Button>
        );
      }
      return null;
    })();

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {ResolvedIcon && (
        <div className="mb-4 text-muted-foreground">{ResolvedIcon}</div>
      )}
      {resolvedTitle && (
        <h3 className="text-lg font-semibold">{resolvedTitle}</h3>
      )}
      {resolvedDescription && (
        <p className="mt-1 text-sm text-muted-foreground max-w-md">
          {resolvedDescription}
        </p>
      )}
      {resolvedAction && <div className="mt-4">{resolvedAction}</div>}
    </div>
  );
}
