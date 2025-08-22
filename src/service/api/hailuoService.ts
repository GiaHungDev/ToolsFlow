import axiosClient from "@/lib/axiosClient";
import { ITopic } from "@/types/hailuo";

export const createTopicService = async (
  title: string,
  prompt: string
): Promise<ITopic> => {
  try {
    const data = {
      title,
      prompt,
    };
    const res: ITopic = await axiosClient.post("prompts/suggest", data);
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Create new topic error in service:", error);
    } else {
      throw new Error("Create new topic error in service!");
    }
  }
};
