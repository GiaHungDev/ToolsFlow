"use client";

import { createHailuoVideo } from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { ITopic } from "@/types/hailuo";
import { convertFilesToBase64 } from "@/utils/convertToBase64Helper";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldErrors, useForm } from "react-hook-form";
import { z } from "zod";

const fileItemSchema = z.object({
  id: z.string(),
  file: z.instanceof(File),
  name: z.string(),
  size: z.number(),
  type: z.string(),
  status: z.string(),
});

export const formSchema = z.object({
  description: z.string().min(1, {
    message: "Hãy nhập mô tả video!",
  }),
  images: z.array(fileItemSchema).min(1, { message: "Hãy upload ảnh!" }),
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

interface UseCreateVideoFormProp {
  formVideo: ReturnType<typeof useFormVideo>;
  handleSetTopic: (topic: ITopic | null) => void;
}

export function useCreateVideoForm({
  formVideo,
  handleSetTopic,
}: UseCreateVideoFormProp) {
  const dispatch = useAppDispatch();
  const { loadHailuo } = useAppSelector((state) => state.hailuo);

  const handleSubmitSuccess = async (values: CreateVideoFormValues) => {
    console.log("🚀 ~ handleSubmitSuccess ~ values:", values);
    try {
      const imageFiles = values.images.map((img) => img.file);
      const base64Images = await convertFilesToBase64(imageFiles);

      const formData = new FormData();
      formData.append("file", values.images[0].file);

      const data = {
        thumbnail: base64Images[0],
        model: "I2V-01-Director",
        prompt: values.description,
        formData: formData,
      };
      console.log("🚀 ~ handleSubmitSuccess ~ data:", data);
      await dispatch(createHailuoVideo({ ...data })).unwrap();
      // clearAllFields(formVideo);
      // handleSetTopic(null);
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
    handleSubmit: formVideo.handleSubmit(
      handleSubmitSuccess,
      handleSubmitError
    ),
    loadHailuo,
  };
}
