import axiosClient from "@/lib/axiosClient";
import { IPrompt, ITopic } from "@/types/hailuo";

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

export const createPromptService = async (data: {
  title: string;
  description: string;
  keywords: string;
}): Promise<IPrompt> => {
  try {
    const res: IPrompt = await axiosClient.post("prompts/generate", {
      ...data,
    });
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Create new topic error in service:", error);
    } else {
      throw new Error("Create new topic error in service!");
    }
  }
};

export const getTopicService = async (): Promise<ITopic[]> => {
  try {
    const res: ITopic[] = await axiosClient.get("prompts/topics");
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Create new topic error in service:", error);
    } else {
      throw new Error("Create new topic error in service!");
    }
  }
};
