import { useCallback, useMemo } from "react";

interface PaginationInfo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface UseTablePaginationProps<
  T extends Record<string, unknown> = Record<string, unknown>
> {
  pagination?: PaginationInfo;
  data: T[];
  enablePagination?: boolean;
  onPaginationChange?: (page: number, limit: number) => void;
}

interface UseTablePaginationReturn {
  currentPage: number;
  pageSize: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  goToPage: (page: number) => void;
  goToFirstPage: () => void;
  goToLastPage: () => void;
  goToPrevPage: () => void;
  goToNextPage: () => void;
  handlePageSizeChange: (newSize: string) => void;
  getPageNumbers: () => (number | string)[];
}

export const useTablePagination = ({
  pagination,
  data,
  enablePagination = true,
  onPaginationChange = () => {},
}: UseTablePaginationProps): UseTablePaginationReturn => {
  // Current pagination state
  const currentPage = pagination?.page || 1;
  const pageSize = pagination?.limit || 10;
  const totalPages = pagination?.totalPages || 1;
  const totalItems = pagination?.total || data.length;

  // Calculate display information
  const startItem = useMemo(() => {
    return enablePagination && pagination
      ? (currentPage - 1) * pageSize + 1
      : 1;
  }, [enablePagination, pagination, currentPage, pageSize]);

  const endItem = useMemo(() => {
    return enablePagination && pagination
      ? Math.min(currentPage * pageSize, totalItems)
      : data.length;
  }, [
    enablePagination,
    pagination,
    currentPage,
    pageSize,
    totalItems,
    data.length,
  ]);

  // Navigation functions
  const goToPage = useCallback(
    (page: number) => {
      const targetPage = Math.max(1, Math.min(page, totalPages));
      if (targetPage !== currentPage) {
        onPaginationChange(targetPage, pageSize);
      }
    },
    [currentPage, totalPages, pageSize, onPaginationChange]
  );

  const goToFirstPage = useCallback(() => {
    goToPage(1);
  }, [goToPage]);

  const goToLastPage = useCallback(() => {
    goToPage(totalPages);
  }, [goToPage, totalPages]);

  const goToPrevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [goToPage, currentPage]);

  const goToNextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [goToPage, currentPage]);

  const handlePageSizeChange = useCallback(
    (newSize: string) => {
      const newLimit = Number(newSize);
      if (newLimit !== pageSize) {
        onPaginationChange(1, newLimit); // Reset về trang 1 khi thay đổi page size
      }
    },
    [pageSize, onPaginationChange]
  );

  // Generate page numbers for pagination
  const getPageNumbers = useCallback((): (number | string)[] => {
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
  }, [currentPage, totalPages]);

  return {
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
  };
};
