import { useAppDispatch } from "@/lib/redux/store";
import { useState } from "react";
import { FilterFormValues, useFormFilter } from "./useFormFilter";
import { FieldErrors } from "react-hook-form";
import dayjs from "dayjs";
import { cleanData } from "@/utils/dataUtils";

interface UseFilterProp {
  formFilter: ReturnType<typeof useFormFilter>;
  onApplyFilter: (filters: any) => void;
}

export const useFilter = ({ formFilter, onApplyFilter }: UseFilterProp) => {
  const dispatch = useAppDispatch();

  const [isOpenFilterModal, setIsOpenFilterModal] = useState<boolean>(false);

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
        values.endDate = values.dateRange.to 
          ? dayjs(values.dateRange.to).format("YYYY-MM-DD")
          : values.startDate;
        delete values.dateRange;
      }
      const filterClear = cleanData(values);
      onApplyFilter(filterClear);
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
