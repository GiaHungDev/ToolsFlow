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
} from "lucide-react";
import { useTableSelection } from "./hooks/useTableSelection";
import { useTablePagination } from "./hooks/useTablePagination";
import { useTableColumns } from "./hooks/useTableColumns";
import { useTableUtils } from "./hooks/useTableUtils";
import { CustomTableProps } from "../CTable/interface";

const CustomTable1 = <T extends Record<string, unknown>>({
  data = [],
  columns = [],
  title = "Data Table",
  description = "",
  maxHeight = "max-h-96",
  enableSelection = true,
  fixedLeftColumns = [],
  fixedRightColumns = [],
  onSelectionChange = () => {},
  onRowAction = () => {},
  className = "",
  rowClassName = () => "",
  zebra = true,
  enablePagination = true,
  pagination,
  pageSizeOptions = [10, 20, 30, 50, 100],
  onPaginationChange = () => {},
  loading = false,
}: CustomTableProps<T>) => {
  // Use selection hook
  const {
    selectedRows,
    isAllCurrentPageSelected,
    isSomeCurrentPageSelected,
    toggleSelectAll,
    toggleSelectRow,
  } = useTableSelection({
    data,
    onSelectionChange,
    enableSelection,
  });

  // Use pagination hook
  const {
    currentPage,
    pageSize,
    totalPages,
    totalItems,
    startItem,
    endItem,
    goToPage,
    goToFirstPage,
    goToLastPage,
    goToPrevPage,
    goToNextPage,
    handlePageSizeChange,
    getPageNumbers,
  } = useTablePagination({
    pagination,
    data,
    enablePagination,
    onPaginationChange,
  });

  // Use columns hook
  const {
    regularColumns,
    getLeftPosition,
    getRightPosition,
    renderCell,
    renderActions,
    getTotalColspan,
  } = useTableColumns({
    columns,
    fixedLeftColumns,
    fixedRightColumns,
    enableSelection,
  });

  // Use utils hook
  const { getRowId, getActualIndex, getRowClassName, isRowSelected } =
    useTableUtils({
      data,
      pagination,
      enablePagination,
      zebra,
      rowClassName,
      selectedRows,
    });

  return (
    <div className={`w-full ${className}`}>
      <div className="bg-white rounded-lg shadow-sm border">
        {/* Header Section */}
        {(title || description || selectedRows.size > 0) && (
          <div className="p-4 border-b">
            {title && (
              <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
            )}
            {description && (
              <p className="text-sm text-gray-600 mt-1">{description}</p>
            )}
            {enableSelection && (
              <p className="text-sm text-gray-600 mt-1">
                {selectedRows.size} of {data.length} rows selected (current
                page)
              </p>
            )}
          </div>
        )}

        {/* Table Content */}
        <div className="relative">
          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center z-50">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-600">Loading...</span>
              </div>
            </div>
          )}

          {/* Scrollable Table */}
          <div className={`${maxHeight} overflow-auto`}>
            <table className="w-full text-sm">
              {/* Header */}
              <thead className="bg-gray-50 sticky top-0 z-20">
                <tr>
                  {/* Selection Column */}
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

                  {/* Fixed Left Columns */}
                  {fixedLeftColumns.map((column, index) => {
                    const isLastFixedLeft =
                      index === fixedLeftColumns.length - 1;
                    return (
                      <th
                        key={String(column.key)}
                        className={`sticky z-30 bg-gray-50 px-4 py-3 text-left font-medium text-gray-900 ${
                          isLastFixedLeft
                            ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                            : ""
                        }`}
                        style={{
                          left: `${getLeftPosition(index)}px`,
                          minWidth: column.width || 96,
                        }}
                      >
                        {column.title}
                      </th>
                    );
                  })}

                  {/* Regular Scrollable Columns */}
                  {regularColumns.map((column) => (
                    <th
                      key={String(column.key)}
                      className="px-4 py-3 text-left font-medium text-gray-900"
                      style={{ minWidth: column.width || 96 }}
                    >
                      {column.title}
                    </th>
                  ))}

                  {/* Fixed Right Columns */}
                  {fixedRightColumns.map((column, index) => {
                    const isFirstFixedRight = index === 0;
                    return (
                      <th
                        key={String(column.key)}
                        className={`sticky z-30 bg-gray-50 px-4 py-3 text-left font-medium text-gray-900 ${
                          isFirstFixedRight
                            ? "shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                            : ""
                        }`}
                        style={{
                          right: `${getRightPosition(index)}px`,
                          minWidth: column.width || 96,
                        }}
                      >
                        {column.title}
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* Body */}
              <tbody>
                {data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={getTotalColspan()}
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
                  data.map((row, rowIndex) => {
                    const actualIndex = getActualIndex(rowIndex);
                    const rowId = getRowId(row, rowIndex);
                    const isSelected = isRowSelected(row, rowIndex);
                    const rowClass = getRowClassName(row, rowIndex, isSelected);

                    return (
                      <tr
                        key={String(rowId)}
                        className={`${rowClass} ${loading ? "opacity-50" : ""}`}
                      >
                        {/* Selection Column */}
                        {enableSelection && (
                          <td className="sticky left-0 z-10 bg-inherit px-4 py-3 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleSelectRow(rowId)}
                              disabled={loading}
                            />
                          </td>
                        )}

                        {/* Fixed Left Columns */}
                        {fixedLeftColumns.map((column, index) => {
                          const isLastFixedLeft =
                            index === fixedLeftColumns.length - 1;
                          return (
                            <td
                              key={String(column.key)}
                              className={`sticky z-10 bg-inherit px-4 py-3 ${
                                isLastFixedLeft
                                  ? "shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                                  : ""
                              }`}
                              style={{ left: `${getLeftPosition(index)}px` }}
                            >
                              <div
                                className={column.className || "text-gray-900"}
                              >
                                {renderCell(column, row, actualIndex)}
                              </div>
                            </td>
                          );
                        })}

                        {/* Regular Scrollable Columns */}
                        {regularColumns.map((column) => (
                          <td key={String(column.key)} className="px-4 py-3">
                            <div
                              className={column.className || "text-gray-600"}
                            >
                              {renderCell(column, row, actualIndex)}
                            </div>
                          </td>
                        ))}

                        {/* Fixed Right Columns */}
                        {fixedRightColumns.map((column, index) => {
                          const isFirstFixedRight = index === 0;
                          return (
                            <td
                              key={String(column.key)}
                              className={`sticky z-10 bg-inherit px-4 py-3 ${
                                isFirstFixedRight
                                  ? "shadow-[-2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                                  : ""
                              }`}
                              style={{ right: `${getRightPosition(index)}px` }}
                            >
                              <div
                                className={column.className || "text-gray-600"}
                              >
                                {column.key === "actions"
                                  ? renderActions(
                                      row,
                                      actualIndex,
                                      onRowAction,
                                      loading
                                    )
                                  : renderCell(column, row, actualIndex)}
                              </div>
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

        {/* Pagination */}
        {enablePagination && pagination && (
          <div className="px-4 py-3 bg-gray-50 border-t">
            {/* Desktop Layout */}
            <div className="hidden lg:flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">Rows per page:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={handlePageSizeChange}
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
                  onClick={goToFirstPage}
                  disabled={currentPage === 1 || loading}
                  className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronsLeft className="w-4 h-4" />
                </button>

                <button
                  onClick={goToPrevPage}
                  disabled={currentPage === 1 || loading}
                  className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex space-x-1">
                  {getPageNumbers().map((page, index) =>
                    page === "..." ? (
                      <span key={index} className="px-3 py-1 text-gray-500">
                        ...
                      </span>
                    ) : (
                      <button
                        key={page}
                        onClick={() => goToPage(page as number)}
                        disabled={loading}
                        className={`px-3 py-1 rounded text-sm min-w-[2rem] disabled:cursor-not-allowed ${
                          currentPage === page
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
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages || loading}
                  className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  onClick={goToLastPage}
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
                    onValueChange={handlePageSizeChange}
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
                    onClick={goToFirstPage}
                    disabled={currentPage === 1 || loading}
                    className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={goToPrevPage}
                    disabled={currentPage === 1 || loading}
                    className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex space-x-1 flex-wrap justify-center">
                  {getPageNumbers()
                    .slice(0, 7)
                    .map((page, index) =>
                      page === "..." ? (
                        <span
                          key={index}
                          className="px-2 py-1 text-gray-500 text-sm"
                        >
                          ...
                        </span>
                      ) : (
                        <button
                          key={page}
                          onClick={() => goToPage(page as number)}
                          disabled={loading}
                          className={`px-2 py-1 rounded text-sm min-w-[2rem] disabled:cursor-not-allowed ${
                            currentPage === page
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
                    onClick={goToNextPage}
                    disabled={currentPage === totalPages || loading}
                    className="p-2 rounded hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={goToLastPage}
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
                    onValueChange={handlePageSizeChange}
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
                    onClick={goToPrevPage}
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
                    onClick={goToNextPage}
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

        {/* Footer without pagination */}
        {!enablePagination && (
          <div className="px-4 py-3 bg-gray-50 text-sm text-gray-600">
            Showing {data.length} results
          </div>
        )}
      </div>
    </div>
  );
};

export default CustomTable1;
