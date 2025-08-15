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
import { ReactNode, useEffect, useState } from "react";
import { CustomTableProps, TableColumn } from "./interface";

const CustomTable = <T extends Record<string, unknown>>({
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
  // Server-side pagination props
  enablePagination = true,
  pagination,
  pageSizeOptions = [10, 20, 30, 50, 100],
  onPaginationChange = () => {},
  loading = false,
}: CustomTableProps<T>) => {
  const [selectedRows, setSelectedRows] = useState<Set<string | number>>(
    new Set()
  );

  // Sử dụng pagination info từ server
  const currentPage = pagination?.page || 1;
  const pageSize = pagination?.limit || 10;
  const totalPages = pagination?.totalPages || 1;
  const totalItems = pagination?.total || data.length;

  // Tính toán thông tin hiển thị
  const startItem =
    enablePagination && pagination ? (currentPage - 1) * pageSize + 1 : 1;
  const endItem =
    enablePagination && pagination
      ? Math.min(currentPage * pageSize, totalItems)
      : data.length;

  useEffect(() => {
    onSelectionChange(Array.from(selectedRows));
  }, [selectedRows, onSelectionChange]);

  // Reset selection khi data thay đổi
  useEffect(() => {
    setSelectedRows(new Set());
  }, [data]);

  const toggleSelectAll = (): void => {
    const currentPageIds = data.map(
      (row, index) =>
        (row as Record<string, unknown> & { id?: string | number }).id || index
    );

    // Chỉ select/deselect items trong trang hiện tại
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
  };

  const toggleSelectRow = (id: string | number): void => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedRows(newSelected);
  };

  const currentPageIds = data.map(
    (row, index) =>
      (row as Record<string, unknown> & { id?: string | number }).id || index
  );
  const isAllCurrentPageSelected =
    currentPageIds.length > 0 &&
    currentPageIds.every((id) => selectedRows.has(id));
  const isSomeCurrentPageSelected =
    currentPageIds.some((id) => selectedRows.has(id)) &&
    !isAllCurrentPageSelected;

  // Pagination functions - gọi callback để server xử lý
  const goToPage = (page: number): void => {
    const targetPage = Math.max(1, Math.min(page, totalPages));
    if (targetPage !== currentPage) {
      onPaginationChange(targetPage, pageSize);
    }
  };

  const goToFirstPage = (): void => goToPage(1);
  const goToLastPage = (): void => goToPage(totalPages);
  const goToPrevPage = (): void => goToPage(currentPage - 1);
  const goToNextPage = (): void => goToPage(currentPage + 1);

  const handlePageSizeChange = (newSize: string): void => {
    const newLimit = Number(newSize);
    if (newLimit !== pageSize) {
      onPaginationChange(1, newLimit); // Reset về trang 1 khi thay đổi page size
    }
  };

  // Generate page numbers for pagination
  const getPageNumbers = (): (number | string)[] => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;

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
  };

  // Tính toán vị trí sticky cho các cột
  const getLeftPosition = (index: number): number => {
    const baseWidth = enableSelection ? 48 : 0;
    const widths = fixedLeftColumns
      .slice(0, index)
      .map((col) => col.width || 96);
    return baseWidth + widths.reduce((sum, width) => sum + width, 0);
  };

  const getRightPosition = (index: number): number => {
    const widths = fixedRightColumns
      .slice(index + 1)
      .map((col) => col.width || 96);
    return widths.reduce((sum, width) => sum + width, 0);
  };

  // Render cell content
  const renderCell = (
    column: TableColumn<T>,
    row: T,
    rowIndex: number
  ): ReactNode => {
    if (column.render) {
      return column.render(row[column.key as keyof T], row, rowIndex);
    }
    return row[column.key as keyof T] as ReactNode;
  };

  // Render action buttons
  const renderActions = (row: T, rowIndex: number): ReactNode => {
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
  };

  const regularColumns = columns.filter(
    (col) =>
      !fixedLeftColumns.some((fixed) => fixed.key === col.key) &&
      !fixedRightColumns.some((fixed) => fixed.key === col.key)
  );

  return (
    <div className={`w-full ${className}`}>
      <div className="bg-white rounded-lg shadow-sm border">
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

        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center z-50">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                <span className="text-gray-600">Loading...</span>
              </div>
            </div>
          )}

          <div className={`${maxHeight} overflow-auto`}>
            <table className="w-full text-sm">
              {/* Fixed Header */}
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

              {/* Table Body */}
              <tbody>
                {data.length === 0 ? (
                  <tr>
                    <td
                      colSpan={
                        (enableSelection ? 1 : 0) +
                        fixedLeftColumns.length +
                        regularColumns.length +
                        fixedRightColumns.length
                      }
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
                    // Với server-side pagination, rowIndex chính là index trong trang hiện tại
                    const actualIndex =
                      enablePagination && pagination
                        ? (currentPage - 1) * pageSize + rowIndex
                        : rowIndex;
                    const rowId =
                      (
                        row as Record<string, unknown> & {
                          id?: string | number;
                        }
                      ).id || rowIndex; // Sử dụng rowIndex thay vì actualIndex để tránh conflict
                    const isSelected = selectedRows.has(rowId);
                    const customRowClass = rowClassName(
                      row,
                      actualIndex,
                      isSelected
                    );

                    return (
                      <tr
                        key={String(rowId)}
                        className={`border-b border-gray-200 hover:bg-gray-50 ${
                          isSelected
                            ? "bg-blue-50"
                            : zebra
                            ? rowIndex % 2 === 0
                              ? "bg-white"
                              : "bg-gray-50"
                            : "bg-white"
                        } ${customRowClass} ${loading ? "opacity-50" : ""}`}
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
                                  ? renderActions(row, actualIndex)
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
                    onValueChange={(value) => handlePageSizeChange(value)}
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
                    onValueChange={(value) => handlePageSizeChange(value)}
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
                    onValueChange={(value) => handlePageSizeChange(value)}
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

export default CustomTable;
