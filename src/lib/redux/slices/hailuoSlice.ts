import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Notify } from "@/lib/Notify";
import {
  createHailuoVideoService,
  createPromptService,
  createPromptT2VService,
  createTopicService,
  deleteHailuoService,
  getHailuoVideoService,
  getTopicService,
  uploadImgToHailuoService,
} from "@/service/api/hailuoService";
import {
  CreateHailuoVideo,
  GetHailuoVideo,
  IHailuoData,
  IHailuoVideo,
  IPaginationHailuo,
  IPrompt,
  IPromptItem,
  ITopic,
} from "@/types/hailuo";

// ==== Async Thunks ====
export const createTopic = createAsyncThunk<
  ITopic,
  { title: string; prompt: string }
>("topics/create", async ({ title, prompt }) => {
  const resData = await createTopicService(title, prompt);
  return resData;
});

export const createPrompt = createAsyncThunk<
  IPrompt,
  {
    title: string;
    description: string;
    keywords: string;
  }
>("prompt/create", async (data) => {
  const resData = await createPromptService(data);
  return resData;
});

export const createPromptT2V = createAsyncThunk<
  string[],
  {
    title: string;
    description: string;
    keywords: string;
    quantity: number;
  }
>("prompt/create/T2V", async (data) => {
  const resData = await createPromptT2VService(data);
  return resData;
});

export const getTopic = createAsyncThunk<ITopic[]>("topics/get", async () => {
  const resData = await getTopicService();
  return resData;
});

export const createHailuoVideo = createAsyncThunk<
  IHailuoVideo,
  CreateHailuoVideo
>("hailuo/create/video", async (data) => {
  if (!data.formData) throw new Error("FormData not found!");
  const uploadImagesToMinimax = await uploadImgToHailuoService(data.formData);

  if (!uploadImagesToMinimax) throw new Error("Upload image to hailuo error!");

  const payload = {
    thumbnail: data.thumbnail,
    model: data.model,
    prompt: data.prompt,
    fileId: uploadImagesToMinimax.fileID,
    topic: data.topic,
  };
  const resData = await createHailuoVideoService({ ...payload });
  return resData;
});

export const getHailuoVideo = createAsyncThunk<IHailuoData, GetHailuoVideo>(
  "hailuo/get/video",
  async (data) => {
    const resData = await getHailuoVideoService({ ...data });
    return resData;
  }
);

export const deleteHailuoVideo = createAsyncThunk<IHailuoVideo, number>(
  "hailuo/delete/video",
  async (data) => {
    const resData = await deleteHailuoService(data);
    return resData;
  }
);

interface IState {
  loadHailuo: {
    loadCreateTopic: boolean;
    loadCreatePrompt: boolean;
    loadCreateVideo: boolean;
    loadGetHailuo: boolean;
    loadDeleteHailuo: boolean;
    loadcreatePromptT2V: boolean;
  };
  topic: ITopic;
  prompt: IPrompt;
  listTopic: ITopic[];
  mapTopic: Record<string, ITopic>;
  hailuoVideo: IHailuoVideo;
  fileID: string;
  listHailuoVideo: IHailuoVideo[];
  paginationHailuo: IPaginationHailuo;
  chooseVideoTopic: ITopic;
  listPrompt: IPromptItem[];
  mapPrompt: Record<string, IPromptItem>;
}

// ==== Initial State ====
const initialState: IState = {
  loadHailuo: {
    loadCreateTopic: false,
    loadCreatePrompt: false,
    loadCreateVideo: false,
    loadGetHailuo: false,
    loadDeleteHailuo: false,
    loadcreatePromptT2V: false,
  },
  topic: {} as ITopic,
  prompt: {} as IPrompt,
  listTopic: [] as ITopic[],
  mapTopic: {},
  hailuoVideo: {} as IHailuoVideo,
  fileID: "",
  listHailuoVideo: [] as IHailuoVideo[],
  paginationHailuo: {} as IPaginationHailuo,
  chooseVideoTopic: {} as ITopic,
  listPrompt: [] as IPromptItem[],
  mapPrompt: {},
};

// ==== Slice ====
export const LoginSlice = createSlice({
  name: "hailuo",
  initialState,
  reducers: {
    setChooseVideoTopic: (state, action: PayloadAction<ITopic>) => {
      state.chooseVideoTopic = action.payload;
      console.log("🚀 ~ state.chooseVideoTopic:", state.chooseVideoTopic);
    },
    clearChooseVideoTopic: (state) => {
      state.chooseVideoTopic = {} as ITopic;
      console.log("🚀 ~ state.clearChooseVideoTopic:", state.chooseVideoTopic);
    },
    updatePromptContent: (
      state,
      action: PayloadAction<{ id: string; content: string }>
    ) => {
      const { id, content } = action.payload;
      const promptIndex = state.listPrompt.findIndex((p) => p.id === id);
      if (promptIndex !== -1) {
        state.listPrompt[promptIndex].content = content;
        console.log(content);
        state.mapPrompt[id].content = content;
      }
    },
    removePrompt: (state, action: PayloadAction<string>) => {
      const promptId = action.payload;
      console.log("promptId:", promptId);
      state.listPrompt = state.listPrompt.filter((p) => p.id !== promptId);
      delete state.mapPrompt[promptId];
    },
    updatePromptCameraMovement: (
      state,
      action: PayloadAction<{ ids: string[]; cameraMovement: string }>
    ) => {
      const { ids, cameraMovement } = action.payload;
      ids.forEach((id) => {
        const promptIndex = state.listPrompt.findIndex((p) => p.id === id);
        if (promptIndex !== -1) {
          let content = state.listPrompt[promptIndex].content;
          // Remove existing camera movement
          content = content.replace(/Camera movement: \[[^\]]*\]/g, "").trim();
          // Add new camera movement
          content = `${content} Camera movement: [${cameraMovement}]`.trim();

          state.listPrompt[promptIndex].content = content;
          state.mapPrompt[id].content = content;
        }
      });
    },
    removePromptCameraMovement: (
      state,
      action: PayloadAction<{ ids: string[] }>
    ) => {
      const { ids } = action.payload;
      ids.forEach((id) => {
        const promptIndex = state.listPrompt.findIndex((p) => p.id === id);
        if (promptIndex !== -1) {
          let content = state.listPrompt[promptIndex].content;
          // Remove camera movement
          content = content.replace(/Camera movement: \[[^\]]*\]/g, "").trim();

          state.listPrompt[promptIndex].content = content;
          state.mapPrompt[id].content = content;
        }
      });
    },
  },
  extraReducers: (builder) => {
    builder
      // topic/create =========================================
      .addCase(createTopic.pending, (state) => {
        state.loadHailuo.loadCreateTopic = true;
      })
      .addCase(
        createTopic.fulfilled,
        (state, action: PayloadAction<ITopic>) => {
          state.loadHailuo.loadCreateTopic = false;
          state.topic = action.payload;
          Notify({
            title: "Tạo chủ đề mới bằng AI thành công.",
            status: "success",
          });
        }
      )
      .addCase(createTopic.rejected, (state, action) => {
        state.loadHailuo.loadCreateTopic = false;
        Notify({
          title: "Tạo chủ để mới bằng Ai lỗi!",
          status: "error",
        });
        console.error("Create topic failed:", action.error);
      })
      // prompt/create =========================================
      .addCase(createPrompt.pending, (state) => {
        state.loadHailuo.loadCreatePrompt = true;
      })
      .addCase(
        createPrompt.fulfilled,
        (state, action: PayloadAction<IPrompt>) => {
          state.loadHailuo.loadCreatePrompt = false;
          state.prompt = action.payload;
          Notify({
            title: "Tạo prompt thành công.",
            status: "success",
          });
        }
      )
      .addCase(createPrompt.rejected, (state, action) => {
        state.loadHailuo.loadCreatePrompt = false;
        Notify({
          title: "Tạo prompt lỗi!",
          status: "error",
        });
        console.error("Create prompt failed:", action.error);
      })
      // prompt/create/T2V =========================================
      .addCase(createPromptT2V.pending, (state) => {
        state.loadHailuo.loadcreatePromptT2V = true;
      })
      .addCase(
        createPromptT2V.fulfilled,
        (state, action: PayloadAction<string[]>) => {
          state.loadHailuo.loadcreatePromptT2V = false;
          // Convert array to objects with IDs
          const promptItems: IPromptItem[] = action.payload.map(
            (content, index) => ({
              id: `prompt_${Date.now()}_${index}`,
              content,
            })
          );

          state.listPrompt = promptItems;

          // Create map for fast lookup
          const map: Record<string, IPromptItem> = {};
          promptItems.forEach((item) => {
            map[item.id] = item;
          });
          state.mapPrompt = map;

          Notify({
            title: "Tạo prompt thành công.",
            status: "success",
          });
        }
      )
      .addCase(createPromptT2V.rejected, (state, action) => {
        state.loadHailuo.loadcreatePromptT2V = false;
        Notify({
          title: "Tạo prompt lỗi!",
          status: "error",
        });
        console.error("Create prompt failed:", action.error);
      })
      // topics/get =========================================
      .addCase(getTopic.pending, (state) => {
        state.loadHailuo.loadGetHailuo = true;
      })
      .addCase(getTopic.fulfilled, (state, action: PayloadAction<ITopic[]>) => {
        state.loadHailuo.loadGetHailuo = false;
        state.listTopic = action.payload;
        const map: Record<string, ITopic> = {};
        action.payload.forEach((t) => {
          map[t.id] = t;
        });
        state.mapTopic = map;
      })
      .addCase(getTopic.rejected, (state, action) => {
        state.loadHailuo.loadGetHailuo = false;
        Notify({
          title: "Tải dữ liệu chủ đề lỗi!",
          status: "error",
        });
        console.error("Get topic failed:", action.error);
      })
      // hailuo/create/video =========================================
      .addCase(createHailuoVideo.pending, (state) => {
        state.loadHailuo.loadCreateVideo = true;
      })
      .addCase(
        createHailuoVideo.fulfilled,
        (state, action: PayloadAction<IHailuoVideo>) => {
          state.loadHailuo.loadCreateVideo = false;
          state.hailuoVideo = action.payload;
          Notify({
            title: "Đang xử lý yêu cầu tạo video",
            description: "Hệ thống đã nhận thông tin và đưa vào hàng chờ.",
            status: "success",
          });
        }
      )
      .addCase(createHailuoVideo.rejected, (state, action) => {
        state.loadHailuo.loadCreateVideo = false;
        Notify({
          title: "Tạo video hailuo lỗi!",
          status: "error",
        });
        console.error("Create video failed:", action.error);
      })
      // hailuo/get/video =========================================
      .addCase(getHailuoVideo.pending, (state) => {
        state.loadHailuo.loadGetHailuo = true;
      })
      .addCase(
        getHailuoVideo.fulfilled,
        (state, action: PayloadAction<IHailuoData>) => {
          state.loadHailuo.loadGetHailuo = false;
          state.listHailuoVideo = action.payload.data;
          state.paginationHailuo = action.payload.pagination;
        }
      )
      .addCase(getHailuoVideo.rejected, (state, action) => {
        state.loadHailuo.loadGetHailuo = false;
        Notify({
          title: "Tải dữ liệu lỗi!",
          status: "error",
        });
        console.error("Create video failed:", action.error);
      })
      // hailuo/get/video =========================================
      .addCase(deleteHailuoVideo.pending, (state) => {
        state.loadHailuo.loadDeleteHailuo = true;
      })
      .addCase(
        deleteHailuoVideo.fulfilled,
        (state, action: PayloadAction<IHailuoVideo>) => {
          state.loadHailuo.loadDeleteHailuo = false;
          const deleteHailuo = action.payload;
          state.listHailuoVideo = state.listHailuoVideo.filter(
            (item) => item.id !== deleteHailuo.id
          );

          Notify({
            title: "Xóa video Hailuo thành công!",
            status: "success",
          });
        }
      )
      .addCase(deleteHailuoVideo.rejected, (state, action) => {
        state.loadHailuo.loadDeleteHailuo = false;
        Notify({
          title: "Xóa video Hailuo lỗi!",
          status: "error",
        });
        console.error("Delete video failed:", action.error);
      });
  },
});

export const {
  setChooseVideoTopic,
  clearChooseVideoTopic,
  updatePromptContent,
  removePrompt,
  updatePromptCameraMovement,
  removePromptCameraMovement,
} = LoginSlice.actions;

export default LoginSlice.reducer;
