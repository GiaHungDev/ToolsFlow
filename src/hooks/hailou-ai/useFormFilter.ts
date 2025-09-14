"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { DateRange } from "react-day-picker";
import { useForm } from "react-hook-form";
import { z } from "zod";

export const formSchema = z.object({
  description: z.string().optional(),
  topic: z.string().optional(),
  status: z.string().optional(),
  dateRange: z.custom<DateRange>().optional(),
});

export type FilterFormValues = z.infer<typeof formSchema>;

export const useFormFilter = () => {
  return useForm<FilterFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      description: undefined,
      topic: undefined,
      status: "completed",
      dateRange: undefined,
    },
  });
};
