import { useState, useEffect, useCallback } from "react";

interface UseTableSelectionProps<T extends Record<string, unknown>> {
  data: T[];
  onSelectionChange?: (selectedIds: (string | number)[]) => void;
  enableSelection?: boolean;
}

interface UseTableSelectionReturn {
  selectedRows: Set<string | number>;
  isAllCurrentPageSelected: boolean;
  isSomeCurrentPageSelected: boolean;
  toggleSelectAll: () => void;
  toggleSelectRow: (id: string | number) => void;
  resetSelection: () => void;
}

export const useTableSelection = <T extends Record<string, unknown>>({
  data,
  onSelectionChange = () => {},
  enableSelection = true,
}: UseTableSelectionProps<T>): UseTableSelectionReturn => {
  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(
    new Set()
  );

  // Reset selection khi data thay đổi
  useEffect(() => {
    setSelectedRows(new Set());
  }, [data]);

  // Notify parent component về selection changes
  useEffect(() => {
    if (enableSelection) {
      onSelectionChange(Array.from(selectedRows));
    }
  }, [selectedRows, onSelectionChange, enableSelection]);

  // Get current page row IDs
  const getCurrentPageIds = useCallback(() => {
    return data.map(
      (row, index) =>
        (row as Record<string, unknown> & { id?: string | number }).id || index
    );
  }, [data]);

  const toggleSelectAll = useCallback(() => {
    if (!enableSelection) return;

    const currentPageIds = getCurrentPageIds();
    const allCurrentSelected = currentPageIds.every((id) =>
      selectedRows.has(id)
    );
    const newSelected = new Set(selectedRows);

    if (allCurrentSelected) {
      currentPageIds.forEach((id) => newSelected.delete(id));
    } else {
      currentPageIds.forEach((id) => newSelected.add(id));
    }
    setSelectedRows(newSelected);
  }, [selectedRows, getCurrentPageIds, enableSelection]);

  const toggleSelectRow = useCallback(
    (id: string | number) => {
      if (!enableSelection) return;

      const newSelected = new Set(selectedRows);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      setSelectedRows(newSelected);
    },
    [selectedRows, enableSelection]
  );

  const resetSelection = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  // Calculate selection states
  const currentPageIds = getCurrentPageIds();
  const isAllCurrentPageSelected =
    enableSelection &&
    currentPageIds.length > 0 &&
    currentPageIds.every((id) => selectedRows.has(id));

  const isSomeCurrentPageSelected =
    enableSelection &&
    currentPageIds.some((id) => selectedRows.has(id)) &&
    !isAllCurrentPageSelected;

  return {
    selectedRows,
    isAllCurrentPageSelected,
    isSomeCurrentPageSelected,
    toggleSelectAll,
    toggleSelectRow,
    resetSelection,
  };
};
