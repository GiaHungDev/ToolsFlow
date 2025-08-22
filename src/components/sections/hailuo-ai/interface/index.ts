import { CreatePromptFormValues } from "@/hooks/hailou-ai/useCreatePrompt";
import { UseFormReturn } from "react-hook-form";

export interface ICreateTopic {
  isOpen: boolean;
  onCancel: () => void;
  setOpen: (open: boolean) => void;
  formPrompt?: UseFormReturn<CreatePromptFormValues>;
}

export interface IUseCreateTopic {
  formPrompt?: UseFormReturn<CreatePromptFormValues>;
  onCancel?: () => void;
}
