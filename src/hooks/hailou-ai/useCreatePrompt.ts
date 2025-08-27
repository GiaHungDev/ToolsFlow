import { IUseCreatePrompt } from "@/components/sections/hailuo-ai/interface";
import { Notify } from "@/lib/Notify";
import { createPrompt } from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { clearAllFields, setFormValues } from "@/utils/formHelpers";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldErrors, useForm } from "react-hook-form";
import z from "zod";

export const formSchema = z.object({
  title: z.string().min(1, { message: "Hãy nhập chủ đề" }),
  description: z.string().min(1, {
    message: "Hãy nhập mô tả video!",
  }),
  keywords: z.string().min(1, { message: "Hãy nhập từ khóa" }),
});

export type CreatePromptFormValues = z.infer<typeof formSchema>;

export const useFormPrompt = () => {
  return useForm<CreatePromptFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      keywords: "",
    },
  });
};

export const useCreatePrompt = (
  { onCancel, formVideo }: IUseCreatePrompt,
  formPrompt: ReturnType<typeof useFormPrompt>
) => {
  const dispatch = useAppDispatch();

  const { loadHailuo } = useAppSelector((state) => state.hailuo);

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

    loadHailuo,
  };
};
