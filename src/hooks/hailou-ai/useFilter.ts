import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { ITopic } from "@/types/hailuo";
import { useState } from "react";
import { FilterFormValues, useFormFilter } from "./useFormFilter";
import { FieldErrors } from "react-hook-form";
import { PaginationInfo } from "@/components/shared/CTable/interface";
import dayjs from "dayjs";
import { cleanData } from "@/utils/dataUtils";
import { getHailuoVideo } from "@/lib/redux/slices/hailuoSlice";

interface UseFilterProp {
  formFilter: ReturnType<typeof useFormFilter>;
  paginationInfo: PaginationInfo;
}

export const useFilter = ({ formFilter, paginationInfo }: UseFilterProp) => {
  const dispatch = useAppDispatch();

  const { listTopic, mapTopic } = useAppSelector((state) => state.hailuo);

  const [isOpenSelectTopic, setIsOpenSelectTopic] = useState<boolean>(false);
  const [topic, setTopic] = useState<ITopic | null>(null);
  const [isOpenFilterModal, setIsOpenFilterModal] = useState<boolean>(false);

  const selected = topic ? mapTopic[topic.id] : null;

  const handleOpenFilterModal = () => {
    setIsOpenFilterModal(true);
  };

  const handleCloseFilterModal = () => {
    setIsOpenFilterModal(false);
  };

  const handleSubmitSuccess = async (values: any) => {
    try {
      if (values.dateRange) {
        values.startDate = dayjs(values.dateRange.from).format("YYYY-MM-DD");
        values.endDate = dayjs(values.dateRange.from).format("YYYY-MM-DD");
        delete values.dateRange;
      }
      const filter = {
        ...values,
        page: paginationInfo.page,
        limit: paginationInfo.limit,
      };

      const filterClear = cleanData(filter);

      await dispatch(
        getHailuoVideo({
          ...filterClear,
        })
      ).unwrap();
      setIsOpenFilterModal(false);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Create new topic error: ${error.message}`);
      } else {
        throw new Error("Create new topic error!");
      }
    }
  };

  const handleSubmitError = (errors: FieldErrors<FilterFormValues>) => {
    console.error("❌ Form validation failed:");
    console.error("Errors:", errors);

    // Log từng field error
    Object.keys(errors).forEach((key) => {
      const error = errors[key as keyof FilterFormValues];
      if (error) {
        console.error(`- ${key}: ${error.message}`);
      }
    });
  };

  return {
    listTopic,
    setIsOpenSelectTopic,
    isOpenSelectTopic,
    setTopic,
    topic,
    selected,
    setIsOpenFilterModal,
    isOpenFilterModal,
    handleOpenFilterModal,
    handleCloseFilterModal,
    handleSubmit: formFilter.handleSubmit(
      handleSubmitSuccess,
      handleSubmitError
    ),
  };
};
