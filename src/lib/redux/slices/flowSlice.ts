import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Notify } from "@/lib/Notify";
import {
  createFlowVideoService,
  createPromptService,
  createPromptT2VService,
  createTopicService,
  deleteFlowService,
  getFlowVideoService,
  getTopicService,
  uploadImgToFlowService,
} from "@/service/api/flowService";
import {
  CreateFlowVideo,
  GetFlowVideo,
  IFlowData,
  IFlowVideo,
  IPaginationFlow,
  IPrompt,
  IPromptItem,
  ITopic,
} from "@/types/flow";

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

export const createFlowVideo = createAsyncThunk<IFlowVideo, CreateFlowVideo>(
  "flow/create/video",
  async (data) => {
    if (!data.formData) throw new Error("FormData not found!");
    const uploadImagesToMinimax = await uploadImgToFlowService(data.formData);

    if (!uploadImagesToMinimax) throw new Error("Upload image to flow error!");

    const payload = {
      thumbnail: data.thumbnail,
      model: data.model,
      prompt: data.prompt,
      fileId: uploadImagesToMinimax.fileID,
      topic: data.topic,
    };
    const resData = await createFlowVideoService({ ...payload });
    return resData;
  }
);

export const createFlowT2V = createAsyncThunk<IFlowVideo, CreateFlowVideo>(
  "flow/create/T2V",
  async (data) => {
    const payload = {
      model: data.model,
      prompt: data.prompt,
      topic: data.topic,
    };
    const resData = await createFlowVideoService({ ...payload });
    return resData;
  }
);

export const getFlowVideo = createAsyncThunk<IFlowData, GetFlowVideo>(
  "flow/get/video",
  async (data) => {
    const resData = await getFlowVideoService({ ...data });
    return resData;
  }
);

export const deleteFlowVideo = createAsyncThunk<IFlowVideo, number>(
  "flow/delete/video",
  async (data) => {
    const resData = await deleteFlowService(data);
    return resData;
  }
);

interface IState {
  loadFlow: {
    loadCreateTopic: boolean;
    loadCreatePrompt: boolean;
    loadCreateVideo: boolean;
    loadGetFlow: boolean;
    loadDeleteFlow: boolean;
    loadcreatePromptT2V: boolean;
    loadCreateT2V: boolean;
  };
  topic: ITopic;
  prompt: IPrompt;
  listTopic: ITopic[];
  mapTopic: Record<string, ITopic>;
  flowVideo: IFlowVideo;
  fileID: string;
  listFlowVideo: IFlowVideo[];
  paginationFlow: IPaginationFlow;
  chooseVideoTopic: ITopic;
  listPrompt: IPromptItem[];
  mapPrompt: Record<string, IPromptItem>;
}

// ==== Initial State ====
const initialState: IState = {
  loadFlow: {
    loadCreateTopic: false,
    loadCreatePrompt: false,
    loadCreateVideo: false,
    loadGetFlow: false,
    loadDeleteFlow: false,
    loadcreatePromptT2V: false,
    loadCreateT2V: false,
  },
  topic: {} as ITopic,
  prompt: {} as IPrompt,
  listTopic: [] as ITopic[],
  mapTopic: {},
  flowVideo: {} as IFlowVideo,
  fileID: "",
  listFlowVideo: [] as IFlowVideo[],
  paginationFlow: {} as IPaginationFlow,
  chooseVideoTopic: {} as ITopic,
  listPrompt: [] as IPromptItem[],
  mapPrompt: {},
};

// ==== Slice ====
export const LoginSlice = createSlice({
  name: "flow",
  initialState,
  reducers: {
    setChooseVideoTopic: (state, action: PayloadAction<ITopic>) => {
      state.chooseVideoTopic = action.payload;
    },
    clearChooseVideoTopic: (state) => {
      state.chooseVideoTopic = {} as ITopic;
    },
    updatePromptContent: (
      state,
      action: PayloadAction<{ id: string; content: string }>
    ) => {
      const { id, content } = action.payload;
      const promptIndex = state.listPrompt.findIndex((p) => p.id === id);
      if (promptIndex !== -1) {
        state.listPrompt[promptIndex].content = content;
        state.mapPrompt[id].content = content;
      }
    },
    removePrompt: (state, action: PayloadAction<string>) => {
      const promptId = action.payload;
      state.listPrompt = state.listPrompt.filter((p) => p.id !== promptId);
      delete state.mapPrompt[promptId];
    },
    removeAllPrompt: (state) => {
      state.listPrompt = [];
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
        state.loadFlow.loadCreateTopic = true;
      })
      .addCase(
        createTopic.fulfilled,
        (state, action: PayloadAction<ITopic>) => {
          state.loadFlow.loadCreateTopic = false;
          state.topic = action.payload;
          Notify({
            title: "Tạo chủ đề mới bằng AI thành công.",
            status: "success",
          });
        }
      )
      .addCase(createTopic.rejected, (state, action) => {
        state.loadFlow.loadCreateTopic = false;
        Notify({
          title: "Tạo chủ để mới bằng Ai lỗi!",
          status: "error",
        });
        console.error("Create topic failed:", action.error);
      })
      // prompt/create =========================================
      .addCase(createPrompt.pending, (state) => {
        state.loadFlow.loadCreatePrompt = true;
      })
      .addCase(
        createPrompt.fulfilled,
        (state, action: PayloadAction<IPrompt>) => {
          state.loadFlow.loadCreatePrompt = false;
          state.prompt = action.payload;
          Notify({
            title: "Tạo prompt thành công.",
            status: "success",
          });
        }
      )
      .addCase(createPrompt.rejected, (state, action) => {
        state.loadFlow.loadCreatePrompt = false;
        Notify({
          title: "Tạo prompt lỗi!",
          status: "error",
        });
        console.error("Create prompt failed:", action.error);
      })
      // prompt/create/T2V =========================================
      .addCase(createPromptT2V.pending, (state) => {
        state.loadFlow.loadcreatePromptT2V = true;
      })
      .addCase(
        createPromptT2V.fulfilled,
        (state, action: PayloadAction<string[]>) => {
          state.loadFlow.loadcreatePromptT2V = false;
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
        state.loadFlow.loadcreatePromptT2V = false;
        Notify({
          title: "Tạo prompt lỗi!",
          status: "error",
        });
        console.error("Create prompt failed:", action.error);
      })
      // topics/get =========================================
      .addCase(getTopic.pending, (state) => {
        state.loadFlow.loadGetFlow = true;
      })
      .addCase(getTopic.fulfilled, (state, action: PayloadAction<ITopic[]>) => {
        state.loadFlow.loadGetFlow = false;
        state.listTopic = action.payload;
        const map: Record<string, ITopic> = {};
        action.payload.forEach((t) => {
          map[t.id] = t;
        });
        state.mapTopic = map;
      })
      .addCase(getTopic.rejected, (state, action) => {
        state.loadFlow.loadGetFlow = false;
        Notify({
          title: "Tải dữ liệu chủ đề lỗi!",
          status: "error",
        });
        console.error("Get topic failed:", action.error);
      })
      .addCase(getFlowVideo.pending, (state) => {
        state.loadFlow.loadGetFlow = true;
      })
      .addCase(
        getFlowVideo.fulfilled,
        (state, action: PayloadAction<IFlowData>) => {
          state.loadFlow.loadGetFlow = false;
          state.listFlowVideo = action.payload.data;
          state.paginationFlow = action.payload.pagination;
        }
      )
      .addCase(getFlowVideo.rejected, (state, action) => {
        state.loadFlow.loadGetFlow = false;
        Notify({
          title: "Tải dữ liệu lỗi!",
          status: "error",
        });
        console.error("Create video failed:", action.error);
      })
      // flow/get/video =========================================
      .addCase(deleteFlowVideo.pending, (state) => {
        state.loadFlow.loadDeleteFlow = true;
      })
      .addCase(
        deleteFlowVideo.fulfilled,
        (state, action: PayloadAction<IFlowVideo>) => {
          state.loadFlow.loadDeleteFlow = false;
          const deleteFlow = action.payload;
          state.listFlowVideo = state.listFlowVideo.filter(
            (item) => item.id !== deleteFlow.id
          );
        }
      )
      .addCase(deleteFlowVideo.rejected, (state, action) => {
        state.loadFlow.loadDeleteFlow = false;
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
  removeAllPrompt,
} = LoginSlice.actions;

export default LoginSlice.reducer;
