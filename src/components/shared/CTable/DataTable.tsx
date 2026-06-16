import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Video,
} from "lucide-react";
import {
  ReactNode,
  useEffect,
  useState,
  useMemo,
  useCallback,
  memo,
} from "react";
import { CustomTableProps, TableColumn } from "./interface";

// Memoized Cell Component
const TableCell = memo<{
  column: TableColumn<any>;
  row: any;
  rowIndex: number;
}>(({ column, row, rowIndex }) => {
  const cellContent = useMemo(() => {
    if (column.render) {
      const value =
        column.key in row ? row[column.key as keyof typeof row] : undefined;
      return column.render(value, row, rowIndex);
    }

    if (column.key in row) {
      const value = row[column.key as keyof typeof row];
      return value as ReactNode;
    }

    return null;
  }, [column, row, rowIndex]);

  return (
    <div className={column.className || "text-gray-600"}>{cellContent}</div>
  );
});

TableCell.displayName = "TableCell";

const DataTable = <T extends object>({
  data = [],
  columns = [],
  title = "Danh Sách Video AI",
  description = "",
  maxHeight = "max-h-96",
  enableSelection = true,
  fixedLeftColumns = [],
  fixedRightColumns = [],
  onSelectionChange = () => { },
  className = "",
  rowClassName = () => "",
  zebra = true,
  // Server-side pagination props
  enablePagination = true,
  pagination,
  pageSizeOptions = [10, 20, 30, 50, 100],
  onPaginationChange = () => { },
  loading = false,
  headerActions,
  clearSelectionOnPageChange = false,
  getRowId,
  selectedRowIds,
}: CustomTableProps<T>) => {
  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(
    new Set()
  );

  // Memoized pagination values
  const paginationInfo = useMemo(() => {
    const currentPage = pagination?.page || 1;
    const pageSize = pagination?.limit || 10;
    const totalItems = pagination?.total || data.length;
    const totalPages = pagination?.totalPages || 1;

    const startItem =
      enablePagination && pagination ? (currentPage - 1) * pageSize + 1 : 1;
    const endItem =
      enablePagination && pagination
        ? Math.min(currentPage * pageSize, totalItems)
        : data.length;

    return {
      currentPage,
      pageSize,
      totalItems,
      totalPages,
      startItem,
      endItem,
    };
  }, [pagination, data.length, enablePagination]);

  const displayData = useMemo(() => {
    const pageSize = paginationInfo.pageSize;
    if (enablePagination && pagination && data.length > pageSize) {
      return data.slice(0, pageSize);
    }
    return data;
  }, [data, enablePagination, pagination, paginationInfo.pageSize]);


  // Memoized row IDs and selection state
  const selectionInfo = useMemo(() => {
    const { currentPage, pageSize } = paginationInfo;
    const currentPageIds = displayData.map((row, index) => {
      const actualIndex =
        enablePagination && pagination
          ? (currentPage - 1) * pageSize + index
          : index;
      if (getRowId) return getRowId(row, actualIndex);
      const rowWithId = row as T & { id?: string | number };
      return rowWithId.id ?? actualIndex;
    });

    const isAllCurrentPageSelected =
      currentPageIds.length > 0 &&
      currentPageIds.every((id) => selectedRows.has(id));

    const isSomeCurrentPageSelected =
      currentPageIds.some((id) => selectedRows.has(id)) &&
      !isAllCurrentPageSelected;

    return {
      currentPageIds,
      isAllCurrentPageSelected,
      isSomeCurrentPageSelected,
    };
  }, [displayData, selectedRows, paginationInfo, enablePagination, pagination]);

  // Memoized column organization
  const columnInfo = useMemo(() => {
    const fixedLeftKeys = new Set(fixedLeftColumns.map((col) => col.key));
    const fixedRightKeys = new Set(fixedRightColumns.map((col) => col.key));

    const regularColumns = columns.filter(
      (col) => !fixedLeftKeys.has(col.key) && !fixedRightKeys.has(col.key)
    );

    const totalColspan =
      (enableSelection ? 1 : 0) +
      fixedLeftColumns.length +
      regularColumns.length +
      fixedRightColumns.length;

    return { regularColumns, totalColspan };
  }, [columns, fixedLeftColumns, fixedRightColumns, enableSelection]);

  // Memoized position calculations
  const positions = useMemo(() => {
    const baseWidth = enableSelection ? 48 : 0;

    const leftPositions = fixedLeftColumns.map((_, index) => {
      const widths = fixedLeftColumns
        .slice(0, index)
        .map((col) => col.width || 96);
      return baseWidth + widths.reduce((sum, width) => sum + width, 0);
    });

    const rightPositions = fixedRightColumns.map((_, index) => {
      const widths = fixedRightColumns
        .slice(index + 1)
        .map((col) => col.width || 96);
      return widths.reduce((sum, width) => sum + width, 0);
    });

    return { leftPositions, rightPositions };
  }, [fixedLeftColumns, fixedRightColumns, enableSelection]);

  // Memoized page numbers
  const pageNumbers = useMemo(() => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    const { totalPages, currentPage } = paginationInfo;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push("...");
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push("...");
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push("...");
        pages.push(totalPages);
      }
    }
    return pages;
  }, [paginationInfo]);

  // Optimized callbacks
  const toggleSelectAll = useCallback((): void => {
    const { currentPageIds } = selectionInfo;
    const allCurrentSelected = currentPageIds.every((id) =>
      selectedRows.has(id)
    );

    setSelectedRows((prev) => {
      const newSelected = new Set(prev);
      if (allCurrentSelected) {
        currentPageIds.forEach((id) => newSelected.delete(id));
      } else {
        currentPageIds.forEach((id) => newSelected.add(id));
      }
      return newSelected;
    });
  }, [selectionInfo, selectedRows]);

  const toggleSelectRow = useCallback((id: string | number): void => {
    setSelectedRows((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(id)) {
        newSelected.delete(id);
      } else {
        newSelected.add(id);
      }
      return newSelected;
    });
  }, []);

  // Memoized pagination handlers
  const paginationHandlers = useMemo(() => {
    const { currentPage, totalPages, pageSize } = paginationInfo;

    return {
      goToPage: (page: number) => {
        const targetPage = Math.max(1, Math.min(page, totalPages));
        if (targetPage !== currentPage) {
          onPaginationChange(targetPage, pageSize);
        }
      },
      goToFirstPage: () => onPaginationChange(1, pageSize),
      goToLastPage: () => onPaginationChange(totalPages, pageSize),
      goToPrevPage: () =>
        onPaginationChange(Math.max(1, currentPage - 1), pageSize),
      goToNextPage: () =>
        onPaginationChange(Math.min(totalPages, currentPage + 1), pageSize),
      handlePageSizeChange: (newSize: string) => {
        const newLimit = Number(newSize);
        if (newLimit !== pageSize) {
          onPaginationChange(1, newLimit);
        }
      },
    };
  }, [paginationInfo, onPaginationChange]);

  useEffect(() => {
    onSelectionChange(Array.from(selectedRows));
  }, [selectedRows, onSelectionChange]);

  useEffect(() => {
    if (selectedRowIds !== undefined) {
      setSelectedRows((prev) => {
        if (prev.size === selectedRowIds.length && selectedRowIds.every(id => prev.has(id))) {
          return prev;
        }
        return new Set(selectedRowIds);
      });
    }
  }, [selectedRowIds]);

  useEffect(() => {
    if (clearSelectionOnPageChange) {
      setSelectedRows(new Set());
    }
  }, [paginationInfo.currentPage, paginationInfo.pageSize, clearSelectionOnPageChange]);

  const { currentPage, pageSize, totalItems, totalPages, startItem, endItem } =
    paginationInfo;
  const {
    isAllCurrentPageSelected,
    isSomeCurrentPageSelected,
  } = selectionInfo;
  const { regularColumns, totalColspan } = columnInfo;
  const { leftPositions, rightPositions } = positions;

  return (
    <div className={`w-full ${className}`}>
      <div className="bg-white rounded-lg shadow-sm border">
        {(title || description || headerActions || selectedRows.size > 0) && (
          <div className="p-4 border-b flex justify-between items-center flex-wrap gap-4">
            <div>
              {title && (
                <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
              )}
              {title === "Danh Sách Video AI" && (
                <p className="text-xs text-gray-500 mt-1">
                  Trạng thái video thành công sẽ được lưu dưới dạng {`{Tên dự án}`} / video_{`{id}`}
                </p>
              )}
              {description && (
                <div className="text-sm text-gray-600 mt-1">{description}</div>
              )}
            </div>

            {headerActions && (
              <div className="flex items-center gap-2">
                {headerActions}
              </div>
            )}
          </div>
        )}

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center z-50">
              <div className="flex items-center space-x-2">
                <div className="relative">
                  <div className="animate-spin rounded-full h-16 w-16 border-2 border-gray-800 border-t-white mx-auto">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Video className="w-7 h-7 text-gray-950 animate-pulse" />
                    </div>
                  </div>
                  <div className="absolute inset-0 rounded-full border border-gray-600 opacity-20 animate-ping"></div>
                </div>
              </div>
            </div>
          )}

          <div className={`${maxHeight} overflow-auto`}>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 z-20">
                <tr>
                  {enableSelection && (
                    <th className="sticky left-0 z-30 bg-gray-50 px-4 py-3 text-left w-12 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                      <Checkbox
                        checked={isAllCurrentPageSelected}
                        onCheckedChange={toggleSelectAll}
                        className="data-[state=indeterminate]:bg-blue-600"
                        disabled={loading}
                        {...(isSomeCurrentPageSelected
                          ? { "data-state": "indeterminate" }
                          : {})}
                      />
                    </th>
                  )}

                  {fixedLeftColumns.map((column, index) => {
                    const isLastFixedLeft =
                      index === fixedLeftColumns.length - 1;
                    return (
                      <th
                        key={String(column.key)}
                        className={`sticky z-30 bg-gray-50 px-4 py-2 text-left font-medium text-gray-900 ${column.className || "text-left"
                          } ${isLastFixedLeft
                            ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                            : ""
                          }`}
                        style={{
                          left: `${leftPositions[index]}px`,
                          minWidth: column.width || 96,
                        }}
                      >
                        {column.title}
                      </th>
                    );
                  })}

                  {regularColumns.map((column) => (
                    <th
                      key={String(column.key)}
                      className={`px-4 py-2 font-medium text-gray-900 ${column.className || "text-left"
                        }`}
                      style={{ minWidth: column.width || 96 }}
                    >
                      {column.title}
                    </th>
                  ))}

                  {fixedRightColumns.map((column, index) => {
                    const isFirstFixedRight = index === 0;
                    return (
                      <th
                        key={String(column.key)}
                        className={`sticky z-30 bg-gray-50 px-4 py-2 text-left font-medium text-gray-900 ${column.className || "text-left"
                          } ${isFirstFixedRight
                            ? "shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                            : ""
                          }`}
                        style={{
                          right: `${rightPositions[index]}px`,
                          minWidth: column.width || 96,
                        }}
                      >
                        {column.title}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {displayData.length === 0 ? (
                  <tr>
                    <td
                      colSpan={totalColspan}
                      className="text-center py-8 text-gray-500"
                    >
                      <div className="flex flex-col items-center justify-center">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="h-12 w-12 text-gray-400 mb-2"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 17v-6h6v6m-6 4h6a2 2 0 002-2v-8a2 2 0 00-2-2H9a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        <p className="text-sm font-medium">
                          {loading ? "Đang tải dữ liệu..." : "Chưa có dữ liệu"}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayData.map((row, rowIndex) => {
                    const actualIndex =
                      enablePagination && pagination
                        ? (currentPage - 1) * pageSize + rowIndex
                        : rowIndex;
                    const rowWithId = row as T & { id?: string | number };
                    const rowId = getRowId ? getRowId(row, actualIndex) : (rowWithId.id ?? actualIndex);
                    const isSelected = selectedRows.has(rowId);
                    const customRowClass = rowClassName(
                      row,
                      actualIndex,
                      isSelected
                    );

                    return (
                      <tr
                        key={String(rowId)}
                        className={`border-b border-gray-200 hover:bg-gray-50 ${isSelected
                          ? "bg-blue-50"
                          : zebra
                            ? rowIndex % 2 === 0
                              ? "bg-white"
                              : "bg-gray-50"
                            : "bg-white"
                          } ${customRowClass} ${loading ? "opacity-50" : ""}`}
                      >
                        {enableSelection && (
                          <td className="sticky left-0 z-10 bg-inherit px-4 py-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelectRow(rowId)}
                              disabled={loading}
                            />
                          </td>
                        )}

                        {fixedLeftColumns.map((column, index) => {
                          const isLastFixedLeft =
                            index === fixedLeftColumns.length - 1;
                          return (
                            <td
                              key={String(column.key)}
                              className={`sticky z-10 bg-inherit px-4 py-2 ${isLastFixedLeft
                                ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                                : ""
                                }`}
                              style={{ left: `${leftPositions[index]}px` }}
                            >
                              <TableCell
                                column={column}
                                row={row}
                                rowIndex={actualIndex}
                              />
                            </td>
                          );
                        })}

                        {regularColumns.map((column) => (
                          <td key={String(column.key)} className="px-4 py-2 text-sm">
                            <TableCell
                              column={column}
                              row={row}
                              rowIndex={actualIndex}
                            />
                          </td>
                        ))}

                        {fixedRightColumns.map((column, index) => {
                          const isFirstFixedRight = index === 0;
                          return (
                            <td
                              key={String(column.key)}
                              className={`sticky z-10 bg-inherit px-4 py-2 ${isFirstFixedRight
                                ? "shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                                : ""
                                }`}
                              style={{ right: `${rightPositions[index]}px` }}
                            >
                              <TableCell
                                column={column}
                                row={row}
                                rowIndex={actualIndex}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {enablePagination && pagination && (
          <div className="px-4 py-3 bg-gray-50 border-t">
            {/* Desktop Layout */}
            <div className="hidden lg:flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Rows per page:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={paginationHandlers.handlePageSizeChange}
                    disabled={loading}
                  >
                    <SelectTrigger className="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-28 h-8">
                      <SelectValue placeholder="Select rows" />
                    </SelectTrigger>
                    <SelectContent>
                      {pageSizeOptions.map((size) => (
                        <SelectItem key={size} value={size.toString()}>
                          {size} / page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-sm text-gray-600">
                  Showing {startItem} to {endItem} of {totalItems} results
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={paginationHandlers.goToFirstPage}
                  disabled={currentPage === 1 || loading}
                  className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={paginationHandlers.goToPrevPage}
                  disabled={currentPage === 1 || loading}
                  className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex space-x-1">
                  {pageNumbers.map((page, index) =>
                    page === "..." ? (
                      <span key={`ellipsis-${index}`} className="px-3 py-1 text-gray-500">
                        ...
                      </span>
                    ) : (
                      <button
                        key={page}
                        onClick={() =>
                          paginationHandlers.goToPage(page as number)
                        }
                        disabled={loading}
                        className={`px-3 py-1 rounded text-sm min-w-[2rem] disabled:cursor-not-allowed ${currentPage === page
                          ? "bg-blue-600 text-white"
                          : "hover:bg-gray-200 text-gray-700"
                          }`}
                      >
                        {page}
                      </button>
                    )
                  )}
                </div>

                <button
                  onClick={paginationHandlers.goToNextPage}
                  disabled={currentPage === totalPages || loading}
                  className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  onClick={paginationHandlers.goToLastPage}
                  disabled={currentPage === totalPages || loading}
                  className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Tablet Layout */}
            <div className="hidden md:flex lg:hidden flex-col space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Rows:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={paginationHandlers.handlePageSizeChange}
                    disabled={loading}
                  >
                    <SelectTrigger className="border border-gray-300 rounded px-2 py-1 text-sm bg-white w-24 h-7">
                      <SelectValue placeholder="Select rows" />
                    </SelectTrigger>
                    <SelectContent>
                      {pageSizeOptions.map((size) => (
                        <SelectItem key={size} value={size.toString()}>
                          {size} / page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-sm text-gray-600">
                  {startItem}-{endItem} of {totalItems}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1">
                  <button
                    onClick={paginationHandlers.goToFirstPage}
                    disabled={currentPage === 1 || loading}
                    className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={paginationHandlers.goToPrevPage}
                    disabled={currentPage === 1 || loading}
                    className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex space-x-1 flex-wrap justify-center">
                  {pageNumbers.slice(0, 7).map((page, index) =>
                    page === "..." ? (
                      <span
                        key={`ellipsis-${index}`}
                        className="px-2 py-1 text-gray-500 text-sm"
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={page}
                        onClick={() =>
                          paginationHandlers.goToPage(page as number)
                        }
                        disabled={loading}
                        className={`px-2 py-1 rounded text-sm min-w-[2rem] disabled:cursor-not-allowed ${currentPage === page
                          ? "bg-blue-600 text-white"
                          : "hover:bg-gray-200 text-gray-700"
                          }`}
                      >
                        {page}
                      </button>
                    )
                  )}
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={paginationHandlers.goToNextPage}
                    disabled={currentPage === totalPages || loading}
                    className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={paginationHandlers.goToLastPage}
                    disabled={currentPage === totalPages || loading}
                    className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Mobile Layout */}
            <div className="flex md:hidden flex-col space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Select
                    value={pageSize.toString()}
                    onValueChange={paginationHandlers.handlePageSizeChange}
                    disabled={loading}
                  >
                    <SelectTrigger className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
                      <SelectValue placeholder="Select rows" />
                    </SelectTrigger>
                    <SelectContent>
                      {pageSizeOptions.map((size) => (
                        <SelectItem key={size} value={size.toString()}>
                          {size} / page
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-sm text-gray-600">
                  {startItem}-{endItem} of {totalItems}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1">
                  <button
                    onClick={paginationHandlers.goToPrevPage}
                    disabled={currentPage === 1 || loading}
                    className="flex items-center space-x-1 px-3 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    <span>Prev</span>
                  </button>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">
                    Page {currentPage} of {totalPages}
                  </span>
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={paginationHandlers.goToNextPage}
                    disabled={currentPage === totalPages || loading}
                    className="flex items-center space-x-1 px-3 py-2 rounded text-sm hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!enablePagination && (
          <div className="px-4 py-3 bg-gray-50 text-sm text-gray-600">
            Showing {data.length} results
          </div>
        )}
      </div>
    </div>
  );
};

export default DataTable;
