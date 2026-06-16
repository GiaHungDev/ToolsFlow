"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { DateRange } from "react-day-picker";
import { useForm } from "react-hook-form";
import { z } from "zod";

export const formSchema = z.object({
  projectName: z.string().optional(),
  status: z.string().optional(),
  dateRange: z.custom<DateRange>().optional(),
});

export type FilterFormValues = z.infer<typeof formSchema>;

export const useFormFilter = () => {
  return useForm<FilterFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      projectName: undefined,
      status: undefined,
      dateRange: undefined,
    },
  });
};
