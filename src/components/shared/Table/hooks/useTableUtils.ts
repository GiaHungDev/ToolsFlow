import { useCallback } from "react";

interface PaginationInfo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface UseTableUtilsProps<T extends Record<string, unknown>> {
  data: T[];
  pagination?: PaginationInfo;
  enablePagination?: boolean;
  zebra?: boolean;
  rowClassName?: (row: T, index: number, isSelected: boolean) => string;
  selectedRows: Set<string | number>;
}

interface UseTableUtilsReturn<T extends Record<string, unknown>> {
  getRowId: (row: T, index: number) => string | number;
  getActualIndex: (rowIndex: number) => number;
  getRowClassName: (row: T, rowIndex: number, isSelected: boolean) => string;
  isRowSelected: (row: T, rowIndex: number) => boolean;
}

export const useTableUtils = <T extends Record<string, unknown>>({
  pagination,
  enablePagination = true,
  zebra = true,
  rowClassName = () => "",
  selectedRows,
}: UseTableUtilsProps<T>): UseTableUtilsReturn<T> => {
  // Get row ID (priority: row.id -> rowIndex)
  const getRowId = useCallback((row: T, index: number): string | number => {
    return (
      (row as Record<string, unknown> & { id?: string | number }).id || index
    );
  }, []);

  // Calculate actual index based on pagination
  const getActualIndex = useCallback(
    (rowIndex: number): number => {
      if (!enablePagination || !pagination) {
        return rowIndex;
      }
      const currentPage = pagination.page || 1;
      const pageSize = pagination.limit || 10;
      return (currentPage - 1) * pageSize + rowIndex;
    },
    [enablePagination, pagination]
  );

  // Check if row is selected
  const isRowSelected = useCallback(
    (row: T, rowIndex: number): boolean => {
      const rowId = getRowId(row, rowIndex);
      return selectedRows.has(rowId);
    },
    [selectedRows, getRowId]
  );

  // Get row className
  const getRowClassName = useCallback(
    (row: T, rowIndex: number, isSelected: boolean): string => {
      const actualIndex = getActualIndex(rowIndex);
      const customRowClass = rowClassName(row, actualIndex, isSelected);

      let baseClass = "border-b border-gray-200 hover:bg-gray-50";

      if (isSelected) {
        baseClass += " bg-blue-50";
      } else if (zebra) {
        baseClass += rowIndex % 2 === 0 ? " bg-white" : " bg-gray-50";
      } else {
        baseClass += " bg-white";
      }

      return `${baseClass} ${customRowClass}`.trim();
    },
    [getActualIndex, rowClassName, zebra]
  );

  return {
    getRowId,
    getActualIndex,
    getRowClassName,
    isRowSelected,
  };
};
