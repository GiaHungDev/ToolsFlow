import axiosClient from "@/lib/axiosClient";
import {
  CreateFlowVideo,
  GetFlowVideo,
  IFilesUpload,
  IFlowData,
  IFlowVideo,
  IPrompt,
  ITopic,
} from "@/types/flow";

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

export const createFlowVideoService = async (
  data: CreateFlowVideo
): Promise<IFlowVideo> => {
  try {
    const res: IFlowVideo = await axiosClient.post("flow/create/videos", {
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

export const uploadImgToFlowService = async (
  formData: FormData
): Promise<IFilesUpload> => {
  try {
    const res: IFilesUpload = await axiosClient.post(
      "flow/upload/images",
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

export const getFlowVideoService = async (
  data: GetFlowVideo
): Promise<IFlowData> => {
  try {
    const res: IFlowData = await axiosClient.get("flow/get/videos", {
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

export const deleteFlowService = async (
  id: number
): Promise<IFlowVideo> => {
  try {
    const res: IFlowVideo = await axiosClient.delete(
      `flow/delete/videos/${id}`
    );
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Delete flow error in service:", error);
    } else {
      throw new Error("Delete flow error in service!");
    }
  }
};
