import axiosClient from "@/lib/axiosClient";
import {
  CreateHailuoVideo,
  GetHailuoVideo,
  IFilesUpload,
  IHailuoData,
  IHailuoVideo,
  IPrompt,
  ITopic,
} from "@/types/hailuo";

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

export const createPromptT2VService = async (data: {
  title: string;
  description: string;
  keywords: string;
  quantity: number;
}): Promise<string[]> => {
  try {
    const res: string[] = await axiosClient.post("prompts/generate-t2v", {
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

export const createHailuoVideoService = async (
  data: CreateHailuoVideo
): Promise<IHailuoVideo> => {
  try {
    const res: IHailuoVideo = await axiosClient.post("hailuo/create/videos", {
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

export const uploadImgToHailuoService = async (
  formData: FormData
): Promise<IFilesUpload> => {
  try {
    const res: IFilesUpload = await axiosClient.post(
      "hailuo/upload/images",
      formData,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );

    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Create new topic error in service:", error);
    } else {
      throw new Error("Create new topic error in service!");
    }
  }
};

export const getHailuoVideoService = async (
  data: GetHailuoVideo
): Promise<IHailuoData> => {
  console.log("🚀 ~ getHailuoVideoService ~ data:", data);
  try {
    const res: IHailuoData = await axiosClient.get("hailuo/get/videos", {
      params: data,
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

export const deleteHailuoService = async (
  id: number
): Promise<IHailuoVideo> => {
  try {
    const res: IHailuoVideo = await axiosClient.delete(
      `hailuo/delete/videos/${id}`
    );
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Delete hailuo error in service:", error);
    } else {
      throw new Error("Delete hailuo error in service!");
    }
  }
};
