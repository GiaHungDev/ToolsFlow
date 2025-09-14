import {
  createTopic,
  getTopic,
  setChooseVideoTopic,
} from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { ITopic } from "@/types/hailuo";
import { clearAllFields, setFormValues } from "@/utils/formHelpers";
import { zodResolver } from "@hookform/resolvers/zod";
import { FieldErrors, useForm, UseFormReturn } from "react-hook-form";
import z from "zod";
import { PromptT2VFormValues } from "./useFormPromptT2V";

export const formSchema = z.object({
  title: z.string().min(1, { message: "Hãy nhập chủ đề" }),
  prompt: z.string().min(1, { message: "Hãy nhập mô tả" }),
});

export type formTopicT2VValues = z.infer<typeof formSchema>;

export const useCreateTopicT2V = (
  formPromptT2V: UseFormReturn<PromptT2VFormValues>,
  onCancelTopicT2V: () => void,
  handleOpenT2VPromptModal: () => void,
  handleSetTopic: (topic: ITopic) => void
) => {
  const dispatch = useAppDispatch();

  const { loadHailuo } = useAppSelector((state) => state.hailuo);

  const formTopicT2V = useForm<formTopicT2VValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      prompt: "",
    },
  });

  const handleSubmitSuccess = async (values: formTopicT2VValues) => {
    try {
      const res = await dispatch(createTopic(values)).unwrap();
      if (res && formPromptT2V) {
        setFormValues(formPromptT2V, {
          title: res.title,
          description: res.description,
          keywords: res.keywords,
        });
        clearAllFields(formTopicT2V);
        onCancelTopicT2V();
        handleOpenT2VPromptModal();
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

  const handleSubmitError = (errors: FieldErrors<formTopicT2VValues>) => {
    console.error("❌ Form validation failed:");
    console.error("Errors:", errors);

    // Log từng field error
    Object.keys(errors).forEach((key) => {
      const error = errors[key as keyof formTopicT2VValues];
      if (error) {
        console.error(`- ${key}: ${error.message}`);
      }
    });
  };

  return {
    formTopicT2V,
    handleSubmit: formTopicT2V.handleSubmit(
      handleSubmitSuccess,
      handleSubmitError
    ),
    loadHailuo,
  };
};
