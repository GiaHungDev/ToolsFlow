import {
  clearChooseVideoTopic,
  getTopic,
  setChooseVideoTopic,
} from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { ITopic } from "@/types/hailuo";
import React, { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { clearAllFields, setFormValues } from "@/utils/formHelpers";
import { Notify } from "@/lib/Notify";
import { CreatePromptFormValues } from "./useFormPrompt";
import { PromptT2VFormValues } from "./useFormPromptT2V";

interface UseSelectTopicProp {
  handleOpenPromptModal: () => void;
  handleOpenT2VPromptModal: () => void;
  formPrompt: UseFormReturn<CreatePromptFormValues>;
  formPromptT2V: UseFormReturn<PromptT2VFormValues>;
}

export const useSelectTopic = ({
  handleOpenPromptModal,
  handleOpenT2VPromptModal,
  formPrompt,
  formPromptT2V,
}: UseSelectTopicProp) => {
  const dispatch = useAppDispatch();

  const { listTopic, mapTopic } = useAppSelector((state) => state.hailuo);

  const [open, setOpen] = React.useState(false);
  const [topic, setTopic] = React.useState<ITopic | null>(null);

  const selected = topic ? mapTopic[topic.id] : null;

  const handleSelectTopicI2V = (topic: ITopic) => {
    console.log("🚀 ~ handleSelectTopicI2V ~ topic:", topic);
    try {
      const selected = topic ? mapTopic[topic.id] : null;
      if (!selected) {
        Notify({
          title: "Chọn chủ đề không thành công",
          description: "Chủ đề bạn chọn không tồn tại trong hệ thống!",
          status: "error",
        });
        throw new Error("Chủ đề select không có!");
      }
      clearAllFields(formPrompt);
      setFormValues(formPrompt, {
        title: selected.title,
        description: selected.description,
        keywords: selected.keywords,
      });
      dispatch(setChooseVideoTopic(selected));
      handleOpenPromptModal();
    } catch (error) {
      console.error(error);
    }
  };

  const handleSelectTopicT2V = (topic: ITopic) => {
    console.log("🚀 ~ handleSelectTopicT2V ~ topic:", topic);
    try {
      const selected = topic ? mapTopic[topic.id] : null;
      if (!selected) {
        Notify({
          title: "Chọn chủ đề không thành công",
          description: "Chủ đề bạn chọn không tồn tại trong hệ thống!",
          status: "error",
        });
        throw new Error("Chủ đề select không có!");
      }
      clearAllFields(formPromptT2V);
      setFormValues(formPromptT2V, {
        title: selected.title,
        description: selected.description,
        keywords: selected.keywords,
      });
      dispatch(setChooseVideoTopic(selected));
      handleOpenT2VPromptModal();
    } catch (error) {
      console.error(error);
    }
  };

  const handleSetTopic = (topic: ITopic | null) => {
    setTopic(topic);
    dispatch(clearChooseVideoTopic());
  };

  useEffect(() => {
    dispatch(getTopic());
  }, [dispatch]);

  return {
    listTopic,
    setOpen,
    open,
    setTopic,
    selected,
    handleSetTopic,
    topic,
    handleSelectTopicI2V,
    handleSelectTopicT2V,
  };
};
