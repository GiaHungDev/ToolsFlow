import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { FieldErrors, useForm } from "react-hook-form";
import z from "zod";

export const formSchema = z.object({
  title: z.string().min(1, { message: "Hãy nhập chủ đề" }),
  description: z.string().min(1, {
    message: "Hãy nhập mô tả video!",
  }),
  keywords: z.string().min(1, { message: "Hãy nhập từ khóa" }),
});

export type CreatePromptFormValues = z.infer<typeof formSchema>;

export const useCreatePrompt = () => {
  const [isOpenTopicModal, setIsOpenTopicModal] = useState<boolean>(false);

  const formPrompt = useForm<CreatePromptFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      keywords: "",
    },
  });

  function handleSubmitSuccess(values: CreatePromptFormValues) {
    console.log("✅ Form submitted successfully:", values);
  }

  function handleSubmitError(errors: FieldErrors<CreatePromptFormValues>) {
    console.error("❌ Form validation failed:");
    console.error("Errors:", errors);

    // Log từng field error
    Object.keys(errors).forEach((key) => {
      const error = errors[key as keyof CreatePromptFormValues];
      if (error) {
        console.error(`- ${key}: ${error.message}`);
      }
    });
  }

  const cancelTopicModal = () => {
    setIsOpenTopicModal(false);
  };

  return {
    formPrompt,
    handleSubmit: formPrompt.handleSubmit(handleSubmitSuccess, handleSubmitError),
    cancelTopicModal,
    // state
    setIsOpenTopicModal,
    isOpenTopicModal,
  };
};
