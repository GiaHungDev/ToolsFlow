"use client";

import {
  createHailuoVideo
} from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { convertFilesToBase64 } from "@/utils/convertToBase64Helper";
import { FieldErrors } from "react-hook-form";
import { CreateVideoFormValues, useFormVideo } from "./useFormVideo";

interface UseCreateVideoFormProp {
  formVideo: ReturnType<typeof useFormVideo>;
}

export const useCreateVideoForm = ({ formVideo }: UseCreateVideoFormProp) => {
  const dispatch = useAppDispatch();
  const { loadHailuo, chooseVideoTopic } = useAppSelector(
    (state) => state.hailuo
  );

  const handleSubmitSuccess = async (values: CreateVideoFormValues) => {
    try {
      if (!chooseVideoTopic)
        throw new Error("Selected topic for creating video not found.");
      console.log(
        "🚀 ~ handleSubmitSuccess ~ chooseVideoTopic:",
        chooseVideoTopic
      );

      const imageFiles = values.images.map((img) => img.file);
      const base64Images = await convertFilesToBase64(imageFiles);

      const formData = new FormData();
      formData.append("file", values.images[0].file);

      const data = {
        thumbnail: base64Images[0],
        model: "I2V-01-Director",
        prompt: values.description,
        formData: formData,
        topic: chooseVideoTopic.id,
      };
      console.log("🚀 ~ handleSubmitSuccess ~ data:", data);
      await dispatch(createHailuoVideo({ ...data })).unwrap();
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
};
