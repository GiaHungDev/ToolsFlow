import { PaginationInfo } from "@/components/shared/CTable/interface";
import { getFlowVideo } from "@/lib/redux/slices/flowSlice";
import { useAppDispatch } from "@/lib/redux/store";
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { cleanData } from "@/utils/dataUtils";
import { useFormFilter } from "./useFormFilter";

export const useTableData = (appliedFilters?: any) => {
  const dispatch = useAppDispatch();

  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [reload, setReload] = useState<boolean>(false);

  useEffect(() => {
    const payload = cleanData({
      ...appliedFilters,
      page: pagination.page,
      limit: pagination.limit,
    });

    dispatch(getFlowVideo(payload));
  }, [dispatch, reload, pagination, appliedFilters]);

  const handlePaginationChange = (page: number, pageSize: number) => {
    setPagination({
      ...pagination,
      page: page,
      limit: pageSize,
    });
  };

  return {
    pagination,
    setPagination,
    setReload,
    handlePaginationChange,
  };
};
