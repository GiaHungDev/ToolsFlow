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
