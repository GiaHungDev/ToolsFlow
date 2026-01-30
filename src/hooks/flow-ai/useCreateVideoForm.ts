"use client";

import { createFlowVideo } from "@/lib/redux/slices/flowSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { convertFilesToBase64 } from "@/utils/convertToBase64Helper";
import { FieldErrors } from "react-hook-form";
import { CreateVideoFormValues, useFormVideo } from "./useFormVideo";

interface UseCreateVideoFormProp {
  formVideo: ReturnType<typeof useFormVideo>;
}

export const useCreateVideoForm = ({ formVideo }: UseCreateVideoFormProp) => {
  const dispatch = useAppDispatch();
  const { loadFlow, chooseVideoTopic } = useAppSelector(
    (state) => state.flow
  );

  const handleSubmitSuccess = async (values: CreateVideoFormValues) => {
    try {
      console.log("🎬 Giá trị videoType nhận được:", values.videoType);
    console.log("🧩 Giá trị full values:", values);

      if (!chooseVideoTopic)
        throw new Error("Selected topic for creating video not found.");

      const imageFiles = values.images.map((img) => img.file);
      const base64Images = await convertFilesToBase64(imageFiles);

      const formData = new FormData();
      formData.append("file", values.images[0].file);
      formData.append("prompt", values.prompt);
      formData.append("typeI2V", values.videoType);
      

      const data = {
        thumbnail: base64Images[0],
        model: "I2V-01-Director",
        prompt: values.prompt,
        videoType: values.videoType,
        formData: formData,
        topic: chooseVideoTopic.id,
      };
      await dispatch(createFlowVideo({ ...data })).unwrap();
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
    loadFlow,
  };
};
