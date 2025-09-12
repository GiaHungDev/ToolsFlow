import { IUseCreateTopic } from "@/components/sections/hailuo-ai/interface";
import {
  createTopic,
  getTopic,
  setChooseVideoTopic,
} from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { clearAllFields, setFormValues } from "@/utils/formHelpers";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldErrors, useForm } from "react-hook-form";
import z from "zod";

export const formSchema = z.object({
  title: z.string().min(1, { message: "Hãy nhập chủ đề" }),
  prompt: z.string().min(1, { message: "Hãy nhập mô tả" }),
});

export type CreateTopicFormValues = z.infer<typeof formSchema>;

export const useCreateTopic = ({
  formPrompt,
  onCancel,
  handleOpenPromptModal,
  handleSetTopic,
}: IUseCreateTopic) => {
  const dispatch = useAppDispatch();

  const { loadHailuo } = useAppSelector((state) => state.hailuo);

  const formTopic = useForm<CreateTopicFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      prompt: "",
    },
  });

  const handleSubmitSuccess = async (values: CreateTopicFormValues) => {
    try {
      const res = await dispatch(createTopic(values)).unwrap();
      if (res && formPrompt) {
        setFormValues(formPrompt, {
          title: res.title,
          description: res.description,
          keywords: res.keywords,
        });
        clearAllFields(formTopic);
        onCancel?.();
        handleOpenPromptModal();
        dispatch(getTopic()).unwrap();
        handleSetTopic(res);
        dispatch(setChooseVideoTopic(res));
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Create new topic error: ${error.message}`);
      } else {
        throw new Error("Create new topic error!");
      }
    }
  };

  const handleSubmitError = (errors: FieldErrors<CreateTopicFormValues>) => {
    console.error("❌ Form validation failed:");
    console.error("Errors:", errors);

    // Log từng field error
    Object.keys(errors).forEach((key) => {
      const error = errors[key as keyof CreateTopicFormValues];
      if (error) {
        console.error(`- ${key}: ${error.message}`);
      }
    });
  };

  return {
    formTopic,
    handleSubmit: formTopic.handleSubmit(
      handleSubmitSuccess,
      handleSubmitError
    ),
    loadHailuo,
  };
};
