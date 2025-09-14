import { Notify } from "@/lib/Notify";
import { createPromptT2V } from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { clearAllFields } from "@/utils/formHelpers";
import { FieldErrors, UseFormReturn } from "react-hook-form";
import { CreatePromptFormValues } from "./useFormPrompt";
import { PromptT2VFormValues } from "./useFormPromptT2V";

export const useCreatePromptT2V = (
  onCancel: () => void,
  formPromptT2V: UseFormReturn<PromptT2VFormValues>,
  handleOpenListPromptModal: (state: boolean) => void
) => {
  const dispatch = useAppDispatch();

  const { loadHailuo } = useAppSelector((state) => state.hailuo);

  const handleSubmitSuccess = async (values: any) => {
    try {
      if (
        !values ||
        !values.title ||
        !values.description ||
        !values.keywords ||
        !values.quantity
      ) {
        Notify({
          title: "Thiếu dữ liệu",
          description: "Thiếu dữ liệu để tạo prompt",
          status: "warning",
        });
        throw new Error("Thiếu dữ liệu tạo Prompt");
      }

      await dispatch(createPromptT2V({ ...values })).unwrap();
      handleOpenListPromptModal(true);
      if (formPromptT2V) clearAllFields(formPromptT2V);
      onCancel();
    } catch (error: unknown) {
      console.error("Lỗi tạo prompt useCreatePromptT2V:", error);
    }
  };

  const handleSubmitError = (errors: FieldErrors<CreatePromptFormValues>) => {
    console.error("❌ Form validation failed:");
    console.error("Errors:", errors);

    // Log từng field error
    Object.keys(errors).forEach((key) => {
      const error = errors[key as keyof CreatePromptFormValues];
      if (error) {
        console.error(`- ${key}: ${error.message}`);
      }
    });
  };

  return {
    handleSubmit: formPromptT2V.handleSubmit(
      handleSubmitSuccess,
      handleSubmitError
    ),
    loadHailuo,
  };
};
