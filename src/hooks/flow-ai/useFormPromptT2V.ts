"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

export const formSchema = z.object({
  title: z.string().min(1, { message: "Hãy nhập chủ đề" }),
  description: z.string().min(1, {
    message: "Hãy nhập mô tả video!",
  }),
  keywords: z.string().min(1, { message: "Hãy nhập từ khóa" }),
  quantity: z.number().min(1, { message: "Hãy nhập số lượng muốn tạo" }),
});

export type PromptT2VFormValues = z.infer<typeof formSchema>;

export const useFormPromptT2V = () => {
  return useForm<PromptT2VFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      keywords: "",
      quantity: 1,
    },
  });
};
