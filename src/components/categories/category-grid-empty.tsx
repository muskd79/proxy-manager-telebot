"use client";

/**
 * Wave 27 PR-2 — empty state for the categories grid.
 *
 * Two flavors via the `mode` prop:
 *   - "filter-empty": filters applied, 0 results — offer "Xoá hết bộ lọc"
 *   - "zero-data": no categories yet — offer "+ Tạo danh mục đầu tiên"
 *
 * Mirrors the canonical EmptyState pattern (UX audit #4); when the
 * shared <EmptyState> component lands the categories page can swap
 * to it. For now we ship a focused inline version.
 */

import { FolderPlus, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CategoryGridEmptyProps {
  mode: "filter-empty" | "zero-data";
  onClearFilters?: () => void;
  onCreateCategory?: () => void;
}

export function CategoryGridEmpty({
  mode,
  onClearFilters,
  onCreateCategory,
}: CategoryGridEmptyProps) {
  if (mode === "filter-empty") {
    return (
      <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 px-6 py-16 text-center">
        <SearchX className="mb-3 h-10 w-10 text-slate-600" aria-hidden="true" />
        <h3 className="text-base font-semibold text-slate-200">
          Không có danh mục khớp bộ lọc
        </h3>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Thử bỏ bớt tiêu chí hoặc bật chế độ "Bao gồm danh mục đã ẩn".
        </p>
        {onClearFilters && (
          <Button
            variant="outline"
            onClick={onClearFilters}
            className="mt-4"
          >
            Xoá hết bộ lọc
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 bg-slate-900/30 px-6 py-16 text-center">
      <FolderPlus
        className="mb-3 h-10 w-10 text-slate-600"
        aria-hidden="true"
      />
      <h3 className="text-base font-semibold text-slate-200">
        Chưa có danh mục nào
      </h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        Tạo danh mục đầu tiên để phân loại proxy theo loại, vùng, hoặc nhà
        cung cấp. Khi thêm proxy vào danh mục, các giá trị mặc định (giá bán,
        quốc gia, ISP, ...) sẽ tự động được điền.
      </p>
      {onCreateCategory && (
        <Button
          onClick={onCreateCategory}
          className="mt-4 bg-orange-500 hover:bg-orange-600"
        >
          + Tạo danh mục đầu tiên
        </Button>
      )}
    </div>
  );
}
