import { ReactNode } from "react";

// Type definitions
export interface TableAction {
  key: string;
  label: string;
  className?: string;
}

export interface TableColumn<
  T extends Record<string, unknown> = Record<string, unknown>
> {
  key: keyof T | "actions";
  title: string;
  width?: number;
  className?: string;
  render?: (value: unknown, row: T, index: number) => ReactNode;
  actions?: TableAction[];
}

interface PaginationInfo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CustomTableProps<
  T extends Record<string, unknown> = Record<string, unknown>
> {
  data: T[];
  columns?: TableColumn<T>[];
  title?: string;
  description?: string;
  maxHeight?: string;
  enableSelection?: boolean;
  fixedLeftColumns?: TableColumn<T>[];
  fixedRightColumns?: TableColumn<T>[];
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
  onRowAction?: (action: string, row: T, index: number) => void;
  className?: string;
  rowClassName?: (row: T, index: number, isSelected: boolean) => string;
  zebra?: boolean;
  // Server-side pagination props
  enablePagination?: boolean;
  pagination?: PaginationInfo; // Thông tin pagination từ server
  pageSizeOptions?: number[];
  onPaginationChange?: (page: number, limit: number) => void; // Callback khi thay đổi page/limit
  loading?: boolean;
}
