import { PaginationInfo } from "@/components/shared/CTable/interface";
import { getHailuoVideo } from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch } from "@/lib/redux/store";
import { useEffect, useState } from "react";

export const useTableData = () => {
  const dispatch = useAppDispatch();

  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });
  const [reload, setReload] = useState<boolean>(false);

  useEffect(() => {
    dispatch(
      getHailuoVideo({
        page: pagination.page,
        limit: pagination.limit,
      })
    );
  }, [dispatch, reload, pagination]);

  const handlePaginationChange = (page: number, pageSize: number) => {
    setPagination({
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
