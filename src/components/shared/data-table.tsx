"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/shared/pagination";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessorKey?: keyof T;
  cell?: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

export type SortDirection = "asc" | "desc" | null;

export interface SortState {
  column: string;
  direction: SortDirection;
}

interface DataTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  loading?: boolean;
  totalCount?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  selectable?: boolean;
  selectedRows?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
  getRowId?: (row: T) => string;
  emptyMessage?: string;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  totalCount,
  page = 1,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  selectable = false,
  selectedRows = new Set(),
  onSelectionChange,
  getRowId = (row: T) => (row as Record<string, unknown>).id as string,
  emptyMessage = "No data found",
}: DataTableProps<T>) {
  const handleSort = (columnId: string) => {
    if (!onSortChange) return;
    if (sort?.column === columnId) {
      if (sort.direction === "asc") {
        onSortChange({ column: columnId, direction: "desc" });
      } else if (sort.direction === "desc") {
        onSortChange({ column: "", direction: null });
      }
    } else {
      onSortChange({ column: columnId, direction: "asc" });
    }
  };

  const handleSelectAll = () => {
    if (!onSelectionChange) return;
    if (selectedRows.size === data.length) {
      onSelectionChange(new Set());
    } else {
      const allIds = new Set(data.map(getRowId));
      onSelectionChange(allIds);
    }
  };

  const handleSelectRow = (rowId: string) => {
    if (!onSelectionChange) return;
    const newSelected = new Set(selectedRows);
    if (newSelected.has(rowId)) {
      newSelected.delete(rowId);
    } else {
      newSelected.add(rowId);
    }
    onSelectionChange(newSelected);
  };

  const SortIcon = ({ columnId }: { columnId: string }) => {
    if (sort?.column !== columnId) {
      return <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />;
    }
    if (sort.direction === "asc") {
      return <ArrowUp className="ml-1 h-3 w-3" />;
    }
    return <ArrowDown className="ml-1 h-3 w-3" />;
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              {selectable && (
                <TableHead className="w-10">
                  <Skeleton className="h-4 w-4" />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.id}>
                  <Skeleton className="h-4 w-24" />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {selectable && (
                  <TableCell>
                    <Skeleton className="h-4 w-4" />
                  </TableCell>
                )}
                {columns.map((col) => (
                  <TableCell key={col.id}>
                    <Skeleton className="h-4 w-full max-w-32" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <Inbox className="mb-3 h-10 w-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedRows.size === data.length && data.length > 0}
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(
                    col.sortable && "cursor-pointer select-none",
                    col.className
                  )}
                  onClick={col.sortable ? () => handleSort(col.id) : undefined}
                >
                  <div className="flex items-center">
                    {col.header}
                    {col.sortable && <SortIcon columnId={col.id} />}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const rowId = getRowId(row);
              return (
                <TableRow
                  key={rowId}
                  data-state={selectedRows.has(rowId) ? "selected" : undefined}
                  className="data-[state=selected]:bg-accent/50"
                >
                  {selectable && (
                    <TableCell>
                      <Checkbox
                        checked={selectedRows.has(rowId)}
                        onCheckedChange={() => handleSelectRow(rowId)}
                      />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.id} className={col.className}>
                      {col.cell
                        ? col.cell(row)
                        : col.accessorKey
                          ? String((row as Record<string, unknown>)[col.accessorKey as string] ?? "")
                          : null}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {totalCount !== undefined && onPageChange && (
        <Pagination
          totalCount={totalCount}
          page={page}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}
