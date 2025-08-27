import { CreatePromptFormValues } from "@/hooks/hailou-ai/useCreatePrompt";
import { CreateVideoFormValues } from "@/hooks/hailou-ai/useCreateVideoForm";
import { ITopic } from "@/types/hailuo";
import { UseFormReturn } from "react-hook-form";

export interface ICreateTopic {
  isOpen: boolean;
  onCancel: () => void;
  setOpen: (open: boolean) => void;
  handleOpenPromptModal: () => void;
  formPrompt: UseFormReturn<CreatePromptFormValues>;
  handleSetTopic: (topic: ITopic) => void;
}

export interface IUseCreateTopic {
  formPrompt: UseFormReturn<CreatePromptFormValues>;
  handleOpenPromptModal: () => void;
  onCancel?: () => void;
  handleSetTopic: (topic: ITopic) => void;
}

export interface ICreatePrompt {
  isOpen: boolean;
  onCancel: () => void;
  setOpen: (open: boolean) => void;
  formVideo: UseFormReturn<CreateVideoFormValues>;
  formPrompt: UseFormReturn<CreatePromptFormValues>;
}

export interface IUseCreatePrompt {
  formVideo: UseFormReturn<CreateVideoFormValues>;
  onCancel?: () => void;
}
