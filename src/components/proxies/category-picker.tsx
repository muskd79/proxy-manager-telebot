"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Wave 23B — picker tái dùng cho dropdown "Danh mục" với option
 * "+ Tạo danh mục mới" inline. Trước đây admin phải mở tab Danh mục
 * riêng để thêm danh mục rồi quay lại form proxy. UX đó bị cắt cực
 * mạnh khi nhập 1000 proxy mà thiếu danh mục mới.
 *
 * Mọi field nâng cao của danh mục (default_country, default_proxy_type,
 * giá, v.v.) vẫn quản lý ở trang /categories. Inline form chỉ tạo
 * danh mục với `name` — caller sẽ chọn nó ngay sau khi tạo.
 */

export interface CategoryOptionLite {
  id: string;
  name: string;
  default_country?: string | null;
  default_proxy_type?: string | null;
}

interface CategoryPickerProps {
  value: string;
  onValueChange: (id: string) => void;
  categories: CategoryOptionLite[];
  onCategoryCreated: (cat: CategoryOptionLite) => void;
  placeholder?: string;
  noneLabel?: string;
}

const CREATE_NEW = "__create_new__";
const NONE = "_none";

export function CategoryPicker({
  value,
  onValueChange,
  categories,
  onCategoryCreated,
  placeholder = "Không phân loại",
  noneLabel = "Không phân loại",
}: CategoryPickerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  function handleSelectChange(v: string | null) {
    if (v === CREATE_NEW) {
      setCreateOpen(true);
      return;
    }
    onValueChange(v === NONE ? "" : (v ?? ""));
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error("Tên danh mục không được trống");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        toast.error(body.error || "Không tạo được danh mục");
        return;
      }
      const created: CategoryOptionLite = {
        id: body.data.id,
        name: body.data.name,
        default_country: body.data.default_country ?? null,
        default_proxy_type: body.data.default_proxy_type ?? null,
      };
      toast.success(`Đã tạo danh mục "${created.name}"`);
      onCategoryCreated(created);
      onValueChange(created.id);
      setNewName("");
      setCreateOpen(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Select
        value={value || NONE}
        onValueChange={handleSelectChange}
      >
        <SelectTrigger>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
              {c.default_proxy_type ? ` · ${String(c.default_proxy_type).toUpperCase()}` : ""}
              {c.default_country ? ` · ${c.default_country}` : ""}
            </SelectItem>
          ))}
          <SelectItem value={CREATE_NEW} className="text-primary">
            <Plus className="size-4 mr-1.5 inline" />
            Tạo danh mục mới
          </SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo danh mục mới</DialogTitle>
            <DialogDescription>
              Đặt tên ngắn cho danh mục. Các thiết lập khác (mặc định loại,
              quốc gia, giá…) chỉnh sau ở tab Danh mục nếu cần.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              placeholder="VD: VN Mobile 4G"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              maxLength={120}
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
            >
              Huỷ
            </Button>
            <Button type="button" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Plus className="size-4 mr-1.5" />}
              Tạo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
