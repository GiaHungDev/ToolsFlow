"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
  prompt: z.string().min(1, { message: "Hãy nhập mô tả video!" }),
  images: z.array(fileItemSchema).min(1, { message: "Hãy upload ảnh!" }),
  videoType: z.enum(["Frames to Video", "Ingredients to Video"]), // đủ rồi
});

export type CreateVideoFormValues = z.infer<typeof formSchema>;

export const useFormVideo = () => {
  return useForm<CreateVideoFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      prompt: "",
      images: [],
      videoType: "Frames to Video",
    },
  });
};
