"use client";

import { z } from "zod";
import { FieldErrors, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

export const formSchema = z.object({
  description: z.string().min(1, {
    message: "Hãy nhập mô tả video!",
  }),
  images: z.array(z.any()).min(1, { message: "Hãy upload ảnh!" }),
});

export type CreateVideoFormValues = z.infer<typeof formSchema>;

export const useFormVideo = () => {
  return useForm<CreateVideoFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: "",
      images: [],
    },
  });
};

export function useCreateVideoForm(
  formVideo?: ReturnType<typeof useFormVideo>
) {
  const handleSubmitSuccess = async (values: CreateVideoFormValues) => {
    console.log("🚀 ~ handleSubmitSuccess ~ values:", values);
    try {
    } catch (error: unknown) {
      console.error("Lỗi tạo prompt useCreatePrompt:", error);
    }
  };

  const handleSubmitError = (errors: FieldErrors<CreateVideoFormValues>) => {
    console.error("❌ Form validation failed:");
    console.error("Errors:", errors);

    // Log từng field error
    Object.keys(errors).forEach((key) => {
      const error = errors[key as keyof CreateVideoFormValues];
      if (error) {
        console.error(`- ${key}: ${error.message}`);
      }
    });
  };

  return {
    handleSubmit: formVideo?.handleSubmit(
      handleSubmitSuccess,
      handleSubmitError
    ),
  };
}
