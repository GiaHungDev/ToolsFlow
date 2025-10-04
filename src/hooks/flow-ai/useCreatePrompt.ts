import { IUseCreatePrompt } from "@/components/sections/flow-ai/interface";
import { Notify } from "@/lib/Notify";
import { createPrompt } from "@/lib/redux/slices/flowSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { clearAllFields, setFormValues } from "@/utils/formHelpers";
import { FieldErrors } from "react-hook-form";
import { CreatePromptFormValues, useFormPrompt } from "./useFormPrompt";

export const useCreatePrompt = (
  { onCancel, formVideo }: IUseCreatePrompt,
  formPrompt: ReturnType<typeof useFormPrompt>
) => {
  const dispatch = useAppDispatch();

  const { loadFlow } = useAppSelector((state) => state.flow);

  const handleSubmitSuccess = async (values: CreatePromptFormValues) => {
    try {
      if (!values || !values.title || !values.description || !values.keywords) {
        Notify({
          title: "Thiếu dữ liệu",
          description: "Thiếu dữ liệu để tạo prompt",
          status: "warning",
        });
        throw new Error("Thiếu dữ liệu tạo Prompt");
      }

      const res = await dispatch(createPrompt({ ...values })).unwrap();

      if (res && formVideo) {
        setFormValues(formVideo, {
          description: res.prompt,
        });
        if (formPrompt) clearAllFields(formPrompt);
        onCancel?.();
      }
    } catch (error: unknown) {
      console.error("Lỗi tạo prompt useCreatePrompt:", error);
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
    handleSubmit: formPrompt.handleSubmit(
      handleSubmitSuccess,
      handleSubmitError
    ),
    loadFlow,
  };
};
