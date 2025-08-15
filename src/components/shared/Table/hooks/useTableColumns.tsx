import { useMemo, useCallback } from "react";
import { ReactNode } from "react";
import { TableColumn } from "../../CTable/interface";

interface UseTableColumnsProps<T extends Record<string, unknown>> {
  columns: TableColumn<T>[];
  fixedLeftColumns: TableColumn<T>[];
  fixedRightColumns: TableColumn<T>[];
  enableSelection?: boolean;
}

interface UseTableColumnsReturn<T extends Record<string, unknown>> {
  regularColumns: TableColumn<T>[];
  getLeftPosition: (index: number) => number;
  getRightPosition: (index: number) => number;
  renderCell: (column: TableColumn<T>, row: T, rowIndex: number) => ReactNode;
  renderActions: (
    row: T,
    rowIndex: number,
    onRowAction: (action: string, row: T, index: number) => void,
    loading?: boolean
  ) => ReactNode;
  getTotalColspan: () => number;
}

export const useTableColumns = <T extends Record<string, unknown>>({
  columns,
  fixedLeftColumns,
  fixedRightColumns,
  enableSelection = true,
}: UseTableColumnsProps<T>): UseTableColumnsReturn<T> => {
  // Filter regular columns (không bao gồm fixed columns)
  const regularColumns = useMemo(() => {
    return columns.filter(
      (col) =>
        !fixedLeftColumns.some((fixed) => fixed.key === col.key) &&
        !fixedRightColumns.some((fixed) => fixed.key === col.key)
    );
  }, [columns, fixedLeftColumns, fixedRightColumns]);

  // Calculate left position for fixed left columns
  const getLeftPosition = useCallback(
    (index: number): number => {
      const baseWidth = enableSelection ? 48 : 0;
      const widths = fixedLeftColumns
        .slice(0, index)
        .map((col) => col.width || 96);
      return baseWidth + widths.reduce((sum, width) => sum + width, 0);
    },
    [fixedLeftColumns, enableSelection]
  );

  // Calculate right position for fixed right columns
  const getRightPosition = useCallback(
    (index: number): number => {
      const widths = fixedRightColumns
        .slice(index + 1)
        .map((col) => col.width || 96);
      return widths.reduce((sum, width) => sum + width, 0);
    },
    [fixedRightColumns]
  );

  // Render cell content
  const renderCell = useCallback(
    (column: TableColumn<T>, row: T, rowIndex: number): ReactNode => {
      if (column.render) {
        return column.render(row[column.key as keyof T], row, rowIndex);
      }
      return row[column.key as keyof T] as ReactNode;
    },
    []
  );

  // Render action buttons
  const renderActions = useCallback(
    (
      row: T,
      rowIndex: number,
      onRowAction: (action: string, row: T, index: number) => void,
      loading = false
    ): ReactNode => {
      const actions = fixedRightColumns.find((col) => col.key === "actions");
      if (actions && actions.actions) {
        return (
          <div className="flex space-x-2">
            {actions.actions.map((action, index) => (
              <button
                key={index}
                onClick={() => onRowAction(action.key, row, rowIndex)}
                className={`text-xs font-medium ${
                  action.className || "text-blue-600 hover:text-blue-800"
                }`}
                disabled={loading}
              >
                {action.label}
              </button>
            ))}
          </div>
        );
      }
      return null;
    },
    [fixedRightColumns]
  );

  // Get total colspan for empty state
  const getTotalColspan = useCallback(() => {
    return (
      (enableSelection ? 1 : 0) +
      fixedLeftColumns.length +
      regularColumns.length +
      fixedRightColumns.length
    );
  }, [
    enableSelection,
    fixedLeftColumns.length,
    regularColumns.length,
    fixedRightColumns.length,
  ]);

  return {
    regularColumns,
    getLeftPosition,
    getRightPosition,
    renderCell,
    renderActions,
    getTotalColspan,
  };
};
