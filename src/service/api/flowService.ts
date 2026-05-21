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
import { Notify } from "@/lib/Notify";

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
    const res: IFlowVideo = await axiosClient.post("flow/veo3", {
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

export const getProjectNamesService = async (): Promise<string[]> => {
  try {
    const res: string[] = await axiosClient.get("flow/veo3/project-names");
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Get project names error in service: ${error.message}`);
    } else {
      throw new Error("Get project names error in service!");
    }
  }
};

export const uploadImgToFlowService = async (
  formData: FormData
): Promise<IFilesUpload | null> => {
  try {
    const res = await axiosClient.post<IFilesUpload>(
      "flow/veo3/upload",
      formData,
      {
        headers: { "Content-Type": "multipart/form-data" },
      }
    );

    Notify({
      title: "Upload thành công ",
      description: "Ảnh đã được lưu vào hệ thống.",
      status: "success",
    });

    return res;
  } catch (error) {
    console.error("Upload image failed:", error);

    Notify({
      title: "Upload thất bại ",
      description: "Vui lòng thử lại sau.",
      status: "error",
    });

    return null;
  }
};


export const getVeo3StreamUrlService = async (id: number) => {
  return axiosClient.get<{ url: string; expiresInSeconds: number }>(
    `flow/veo3/${id}/stream-url`
  );
};

export const resetVideoPendingService = async (
  id: number,
  ownerId: number
) => {
  const formData = new FormData();
  formData.append("ownerId", String(ownerId));

  return axiosClient.patch(
    `flow/veo3/${id}/reset-pending`,
    formData,
    {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    }
  );
};

// export const createFlowT2VService = async (
//   sceneNumber: number,
//   prompt: string,
//   ownerId: number
// ) => {
//   try {
//     const formData = new FormData();
//     formData.append("prompt", prompt);
//     formData.append("ownerId", String(ownerId));
//     formData.append("sceneNumber", String(sceneNumber));
//     formData.append("typeI2V", "Text to Video");

//     return await axiosClient.post("flow/upload-veo3", formData, {
//       headers: { "Content-Type": "multipart/form-data" },
//     });
//   } catch (error: any) {
//     console.error("❌ Lỗi createFlowT2VService:", error?.response?.data || error);
//     return null;
//   }
// };

export const convertBase64ToFile = (base64String: string, mimeType: string, filename: string) => {
  const byteString = atob(base64String);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], { type: mimeType });
  return new File([blob], filename, { type: mimeType });
};


export const createFlowT2VService = async (
  sceneNumber: number,
  prompt: string,
  ownerId: number,
  images?: any[] 
) => {
  try {
    const formData = new FormData();
    formData.append("prompt", prompt);
    formData.append("ownerId", String(ownerId));
    formData.append("sceneNumber", String(sceneNumber));
    

    const hasImages = images && images.length > 0;
    formData.append("typeI2V", hasImages ? "Ingredients to Video" : "Text to Video");

    if (hasImages) {
      const pathsObj: Record<string, string> = {};
      let counter = 1;
      images.forEach((img) => {
        if (img && img.path) {
          pathsObj[`Image${counter}`] = img.path;
          counter++;
        }
      });
      formData.append("imagePaths", JSON.stringify(pathsObj));
    }

    return await axiosClient.post("flow/veo3/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  } catch (error: any) {
    console.error("❌ Lỗi createFlowT2VService:", error?.response?.data || error);
    return null;
  }
};

export const createFlowBatchService = async (
  scenes: { prompt: string; typeI2V: string; sceneNumber: number }[],
  ownerId: number,
  allImages: any[] = [],
  projectName: string = ""
) => {
  try {
    const formData = new FormData();
    formData.append("ownerId", String(ownerId));
    formData.append("scenes", JSON.stringify(scenes));
    if (projectName) {
      formData.append("projectName", projectName);
    }

    if (allImages && allImages.length > 0) {
      const pathsObj: Record<string, string> = {};
      let counter = 1;
      allImages.forEach((img) => {
        if (img && img.path) {
          pathsObj[`Image${counter}`] = img.path;
          counter++;
        }
      });
      formData.append("imagePaths", JSON.stringify(pathsObj));
    }

    return await axiosClient.post("flow/veo3/upload-batch", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  } catch (error: any) {
    console.error("❌ Lỗi createFlowBatchService:", error?.response?.data || error);
    return null;
  }
};

export const getFlowVideoService = async (
  data: GetFlowVideo
): Promise<IFlowData> => {
  try {
    const res: IFlowData = await axiosClient.get("flow/veo3", {
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

export const deleteFlowService = async (id: number): Promise<IFlowVideo> => {
  try {
    const res: IFlowVideo = await axiosClient.delete(
      `flow/veo3/${id}`
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
