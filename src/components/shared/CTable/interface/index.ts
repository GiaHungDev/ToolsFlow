import { ReactNode } from "react";

// Type definitions
export interface TableAction {
  key: string;
  label: string;
  className?: string;
}

export interface TableColumn<T> {
  key: keyof T | string;
  title: string;
  width?: number;
  className?: string;
  render?: (value: any, row: T, index: number) => ReactNode;
  actions?: TableAction[];
}

export interface PaginationInfo {
  total?: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface CustomTableProps<T extends object> {
  data: T[];
  columns?: TableColumn<T>[];
  title?: string;
  description?: string;
  maxHeight?: string;
  enableSelection?: boolean;
  fixedLeftColumns?: TableColumn<T>[];
  fixedRightColumns?: TableColumn<T>[];
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
  className?: string;
  rowClassName?: (row: T, index: number, isSelected: boolean) => string;
  zebra?: boolean;
  // Server-side pagination props
  enablePagination?: boolean;
  pagination?: PaginationInfo; // Thông tin pagination từ server
  pageSizeOptions?: number[];
  onPaginationChange?: (page: number, limit: number) => void;
  loading?: boolean;
  headerActions?: ReactNode;
}
