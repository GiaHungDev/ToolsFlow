import { CreatePromptFormValues } from "@/hooks/flow-ai/useFormPrompt";
import { CreateVideoFormValues } from "@/hooks/flow-ai/useFormVideo";
import { ITopic } from "@/types/flow";
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
