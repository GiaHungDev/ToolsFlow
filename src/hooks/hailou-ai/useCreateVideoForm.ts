"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

export const formSchema = z.object({
  videoDescription: z.string().min(1, {
    message: "Hãy nhập mô tả video!",
  }),
  images: z.array(z.any()).min(1, { message: "Hãy upload ảnh!" }),
});

export type CreateVideoFormValues = z.infer<typeof formSchema>;

export function useCreateVideoForm() {
  const form = useForm<CreateVideoFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      videoDescription: "",
      images: [],
    },
  });

  function handleSubmit(values: CreateVideoFormValues) {
    console.log("values", values);
  }

  return {
    form,
    handleSubmit: form.handleSubmit(handleSubmit),
  };
}
