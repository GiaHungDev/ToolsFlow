import { getTopic } from "@/lib/redux/slices/hailuoSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { ITopic } from "@/types/hailuo";
import React, { useEffect } from "react";

export const useSelectTopic = () => {
  const dispatch = useAppDispatch();

  const { listTopic, mapTopic } = useAppSelector((state) => state.hailuo);

  const [open, setOpen] = React.useState(false);
  const [topic, setTopic] = React.useState<ITopic | null>(null);
  console.log("🚀 ~ useSelectTopic ~ topic:", topic);

  const selected = topic ? mapTopic[topic.id] : null;

  const handleSelect = (topic: ITopic) => {
    console.log(topic);
  };

  const handleSetTopic = (topic: ITopic | null) => {
    setTopic(topic);
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
    handleSelect,
  };
};
