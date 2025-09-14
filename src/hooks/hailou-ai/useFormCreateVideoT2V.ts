"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

export const formSchema = z.object({
  description: z.string().min(1, {
    message: "Hãy nhập mô tả video!",
  }),
});

export type CreateVideoFormT2VValues = z.infer<typeof formSchema>;

export const useFormCreateVideoT2V = () => {
  return useForm<CreateVideoFormT2VValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: "",
    },
  });
};
