"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronsUpDown, ChevronUp, FileText } from "lucide-react";
import React from "react";

export interface Column<T = unknown> {
  key: string;
  label: string;
  sortable?: boolean;
  width?: string;
  fixed?: "left" | "right";
  align?: "left" | "center" | "right";
  render?: (value: unknown, row: T, index: number) => React.ReactNode;
  className?: string;
}

export interface RowAction<T = unknown> {
  label: string;
  icon?: React.ReactNode;
  onClick: (row: T, index: number) => void;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
  disabled?: (row: T) => boolean;
}

interface FlexibleTableProps<T = unknown> {
  data: T[];
  columns: Column<T>[];
  rowKey?: keyof T | ((row: T) => string | number);
  selectable?: boolean;
  pagination?: boolean;
  pageSize?: number;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onRowClick?: (row: T, index: number) => void;
  loading?: boolean;
  emptyMessage?: string;
  size?: "sm" | "md" | "lg";
  tableHeight?: string | number;
}

const sizeClasses = {
  sm: { table: "text-xs", cell: "px-3 py-2" },
  md: { table: "text-sm", cell: "px-4 py-3" },
  lg: { table: "text-base", cell: "px-6 py-4" },
};

export function FlexibleTable<T extends Record<string, unknown>>({
  data = [],
  columns = [],
  rowKey = "id",
  selectable = false,
  pagination = false,
  pageSize = 10,
  currentPage = 1,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  loading = false,
  emptyMessage = "Không có dữ liệu",
  size = "md",
  tableHeight,
}: FlexibleTableProps<T>) {
  const [sortConfig, setSortConfig] = React.useState<{
    key: string;
    direction: "asc" | "desc";
  } | null>(null);
  const [selectedRows, setSelectedRows] = React.useState<T[]>([]);

  const sizeStyle = sizeClasses[size];

  const getRowKey = (row: T, index: number) => {
    if (typeof rowKey === "function") return rowKey(row);
    return (row[rowKey as keyof T] as string | number) ?? index;
  };

  const handleSort = (columnKey: string) => {
    setSortConfig((prev) => {
      if (prev?.key === columnKey) {
        return {
          key: columnKey,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      return { key: columnKey, direction: "asc" };
    });
  };

  const getValue = React.useCallback(
    (row: T, key: string): string | number | Date | undefined => {
      return row[key as keyof T] as string | number | Date | undefined;
    },
    []
  );

  const sortedData = React.useMemo(() => {
    if (!sortConfig) return data;
    return [...data].sort((a, b) => {
      const aVal = getValue(a, sortConfig.key);
      const bVal = getValue(b, sortConfig.key);

      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (
        typeof aVal === "string" &&
        typeof bVal === "string" &&
        !isNaN(Date.parse(aVal)) &&
        !isNaN(Date.parse(bVal))
      ) {
        return sortConfig.direction === "asc"
          ? new Date(aVal).getTime() - new Date(bVal).getTime()
          : new Date(bVal).getTime() - new Date(aVal).getTime();
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      return sortConfig.direction === "asc"
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
  }, [data, sortConfig, getValue]);

  const pagedData = React.useMemo(() => {
    if (!pagination) return sortedData;
    const start = (currentPage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, pagination, currentPage, pageSize]);

  const toggleSelectAll = () => {
    if (selectedRows.length === pagedData.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(pagedData);
    }
  };

  const toggleSelectRow = (row: T) => {
    const key = getRowKey(row, 0);
    setSelectedRows((prev) =>
      prev.some((r) => getRowKey(r, 0) === key)
        ? prev.filter((r) => getRowKey(r, 0) !== key)
        : [...prev, row]
    );
  };

  const renderSortIcon = (column: Column<T>) => {
    if (!column.sortable) return null;
    if (sortConfig?.key !== column.key)
      return (
        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50 transition-opacity group-hover:opacity-80" />
      );
    return sortConfig.direction === "asc" ? (
      <ChevronUp className="ml-2 h-4 w-4 text-blue-600" />
    ) : (
      <ChevronDown className="ml-2 h-4 w-4 text-blue-600" />
    );
  };

  const getFixedClass = (col: Column<T>) => {
    if (!col.fixed) return "";
    if (col.fixed === "left") return "sticky left-0 z-10 bg-white";
    if (col.fixed === "right") return "sticky right-0 z-10 bg-white";
    return "";
  };

  if (loading) {
    return (
      <div className="w-full space-y-4">
        <div className="bg-gradient-to-r from-white to-gray-50/50 rounded-xl shadow-lg border border-gray-200/60 overflow-hidden backdrop-blur-sm">
          <Table className={cn(sizeStyle.table)}>
            <TableHeader>
              <TableRow className="bg-gradient-to-r from-slate-50 to-gray-50 hover:from-slate-100 hover:to-gray-100 border-b border-gray-200/80">
                {selectable && (
                  <TableHead className={cn(sizeStyle.cell, "w-12")}>
                    <Skeleton className="h-4 w-4 rounded" />
                  </TableHead>
                )}
                {columns.map((col) => (
                  <TableHead key={col.key} className={cn(sizeStyle.cell)}>
                    <Skeleton className="h-4 w-24" />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: pageSize }, (_, index) => (
                <TableRow key={index}>
                  {selectable && (
                    <TableCell className={cn(sizeStyle.cell, "w-12")}>
                      <Skeleton className="h-4 w-4 rounded" />
                    </TableCell>
                  )}
                  {columns.map((col) => (
                    <TableCell key={col.key} className={sizeStyle.cell}>
                      <Skeleton className="h-4 w-full max-w-[200px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl shadow-sm border border-gray-200 p-12">
        <div className="flex flex-col items-center justify-center text-gray-500">
          <div className="w-20 h-20 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center mb-6 shadow-inner">
            <FileText className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">
            Chưa có dữ liệu
          </h3>
          <p className="text-sm text-gray-500 text-center max-w-sm">
            {emptyMessage}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="w-full space-y-4">
        {/* Table with enhanced styling and proper scroll handling */}
        <div className="bg-gradient-to-r from-white to-gray-50/50 rounded-xl shadow-sm border border-gray-200/60 backdrop-blur-sm">
          <div
            className="grid w-full"
            style={{ maxHeight: tableHeight ? `${tableHeight}px` : undefined }}
          >
            <Table>
              <TableHeader>
                <TableRow className="[&>*]:whitespace-nowrap sticky top-0 bg-background after:content-[''] after:inset-x-0 after:h-px after:bg-border after:absolute after:bottom-0">
                  {selectable && (
                    <TableHead
                      className={cn(
                        sizeStyle.cell,
                        "w-12 sticky left-0 bg-white z-10"
                      )}
                    >
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 transition-colors shadow-sm"
                          checked={
                            selectedRows.length === pagedData.length &&
                            pagedData.length > 0
                          }
                          onChange={toggleSelectAll}
                        />
                      </div>
                    </TableHead>
                  )}
                  {columns.map((col) => (
                    <TableHead
                      key={col.key}
                      className={cn(
                        sizeStyle.cell,
                        col.align === "center" && "text-center",
                        col.align === "right" && "text-right",
                        col.sortable &&
                          "cursor-pointer select-none hover:bg-white/80",
                        getFixedClass(col),
                        col.className
                      )}
                      style={col.width ? { width: col.width } : undefined}
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      <div className="flex items-center justify-start">
                        <span className="truncate relative">
                          {col.label}
                          {col.sortable && sortConfig?.key === col.key && (
                            <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-blue-500 rounded-full"></div>
                          )}
                        </span>
                        {renderSortIcon(col)}
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody >
                {pagedData.map((row, index) => {
                  const isSelected = selectedRows.some(
                    (r) => getRowKey(r, 0) === getRowKey(row, 0)
                  );
                  return (
                    <TableRow
                      key={getRowKey(row, index)}
                      className={cn(
                        "border-b border-gray-100/60 transition-all duration-200 hover:bg-gradient-to-r hover:from-blue-50/40 hover:to-indigo-50/20 group",
                        isSelected &&
                          "bg-gradient-to-r from-blue-50 to-indigo-50/30 hover:from-blue-100/50 hover:to-indigo-100/40",
                        onRowClick && "cursor-pointer"
                      )}
                      onClick={() => onRowClick?.(row, index)}
                    >
                      {selectable && (
                        <TableCell
                          className={cn(
                            sizeStyle.cell,
                            "w-12 sticky left-0 bg-white z-10"
                          )}
                        >
                          <div className="flex items-center justify-center">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 transition-all duration-200 shadow-sm"
                              checked={isSelected}
                              onChange={() => toggleSelectRow(row)}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </TableCell>
                      )}
                      {columns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={cn(
                            sizeStyle.cell,
                            col.align === "center" && "text-center",
                            col.align === "right" && "text-right",
                            getFixedClass(col)
                          )}
                          style={col.width ? { width: col.width } : undefined}
                        >
                          <div className="whitespace-nowrap">
                            {col.render
                              ? col.render(row[col.key as keyof T], row, index)
                              : (row[col.key as keyof T] as React.ReactNode)}
                          </div>
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Enhanced Pagination */}
        {pagination && (
          <div className="flex items-center justify-between bg-gradient-to-r from-white to-gray-50/50 px-6 py-4 rounded-xl shadow-sm border border-gray-200/60 backdrop-blur-sm">
            {/* Results info with badge */}
            <div className="flex items-center gap-3">
              <div className="text-sm text-gray-600">
                Hiển thị{" "}
                <Badge
                  variant="secondary"
                  className="mx-1 bg-blue-100 text-blue-700"
                >
                  {Math.min((currentPage - 1) * pageSize + 1, data.length)}-
                  {Math.min(currentPage * pageSize, data.length)}
                </Badge>
                trong tổng số{" "}
                <Badge variant="outline" className="mx-1 border-gray-300">
                  {data.length}
                </Badge>
                kết quả
              </div>
            </div>

            {/* Pagination controls */}
            <div className="flex items-center gap-6">
              {/* Page size selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 whitespace-nowrap">
                  Hiển thị:
                </span>
                <Select
                  value={pageSize.toString()}
                  onValueChange={(value) => {
                    const newSize = Number(value);
                    onPageSizeChange?.(newSize);
                    onPageChange?.(1);
                  }}
                >
                  <SelectTrigger className="w-20 h-8 text-sm shadow-sm border-gray-300 hover:border-blue-400 transition-colors">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50].map((size) => (
                      <SelectItem key={size} value={size.toString()}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Pagination numbers */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPageChange?.(currentPage - 1)}
                      disabled={currentPage <= 1}
                      className="h-9 w-9 p-0 hover:bg-blue-50 text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      <ChevronUp className="h-4 w-4 rotate-[-90deg]" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Trang trước</p>
                  </TooltipContent>
                </Tooltip>

                {(() => {
                  const totalPages = Math.ceil(data.length / pageSize);
                  const pages = [];

                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) {
                      pages.push(i);
                    }
                  } else {
                    if (currentPage <= 4) {
                      pages.push(1, 2, 3, 4, 5, "...", totalPages);
                    } else if (currentPage >= totalPages - 3) {
                      pages.push(
                        1,
                        "...",
                        totalPages - 4,
                        totalPages - 3,
                        totalPages - 2,
                        totalPages - 1,
                        totalPages
                      );
                    } else {
                      pages.push(
                        1,
                        "...",
                        currentPage - 1,
                        currentPage,
                        currentPage + 1,
                        "...",
                        totalPages
                      );
                    }
                  }

                  return pages.map((page, index) =>
                    page === "..." ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="h-9 w-9 flex items-center justify-center text-gray-400 text-sm"
                      >
                        ...
                      </span>
                    ) : (
                      <Button
                        key={page}
                        variant={currentPage === page ? "default" : "ghost"}
                        size="sm"
                        onClick={() => onPageChange?.(page as number)}
                        className={cn(
                          "h-9 w-9 p-0 transition-all duration-200 shadow-sm hover:shadow-md",
                          currentPage === page
                            ? "bg-blue-600 hover:bg-blue-700 text-white shadow-md"
                            : "text-gray-700 hover:bg-blue-50 hover:text-blue-600"
                        )}
                      >
                        {page}
                      </Button>
                    )
                  );
                })()}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPageChange?.(currentPage + 1)}
                      disabled={
                        currentPage >= Math.ceil(data.length / pageSize)
                      }
                      className="h-9 w-9 p-0 hover:bg-blue-50 text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      <ChevronUp className="h-4 w-4 rotate-90" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Trang sau</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
