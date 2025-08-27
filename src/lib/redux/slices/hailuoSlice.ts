import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Notify } from "@/lib/Notify";
import {
  createPromptService,
  createTopicService,
  getTopicService,
} from "@/service/api/hailuoService";
import { IPrompt, ITopic } from "@/types/hailuo";

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

export const getTopic = createAsyncThunk<ITopic[]>("topics/get", async () => {
  const resData = await getTopicService();
  return resData;
});

interface IState {
  loadHailuo: boolean;
  topic: ITopic;
  prompt: IPrompt;
  listTopic: ITopic[];
  mapTopic: Record<string, ITopic>;
}

// ==== Initial State ====
const initialState: IState = {
  loadHailuo: false,
  topic: {} as ITopic,
  prompt: {} as IPrompt,
  listTopic: [] as ITopic[],
  mapTopic: {},
};

// ==== Slice ====
export const LoginSlice = createSlice({
  name: "hailuo",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // topic/create =========================================
      .addCase(createTopic.pending, (state) => {
        state.loadHailuo = true;
      })
      .addCase(
        createTopic.fulfilled,
        (state, action: PayloadAction<ITopic>) => {
          state.loadHailuo = false;
          state.topic = action.payload;
          Notify({
            title: "Tạo chủ đề mới bằng AI thành công.",
            status: "success",
          });
        }
      )
      .addCase(createTopic.rejected, (state, action) => {
        state.loadHailuo = false;
        Notify({
          title: "Tạo chủ để mới bằng Ai lỗi!",
          status: "error",
        });
        console.error("Logout failed:", action.error);
      })
      // prompt/create =========================================
      .addCase(createPrompt.pending, (state) => {
        state.loadHailuo = true;
      })
      .addCase(
        createPrompt.fulfilled,
        (state, action: PayloadAction<IPrompt>) => {
          state.loadHailuo = false;
          state.prompt = action.payload;
          Notify({
            title: "Tạo prompt thành công.",
            status: "success",
          });
        }
      )
      .addCase(createPrompt.rejected, (state, action) => {
        state.loadHailuo = false;
        Notify({
          title: "Tạo prompt lỗi!",
          status: "error",
        });
        console.error("Logout failed:", action.error);
      })
      // topics/get =========================================
      .addCase(getTopic.pending, (state) => {
        state.loadHailuo = true;
      })
      .addCase(getTopic.fulfilled, (state, action: PayloadAction<ITopic[]>) => {
        state.loadHailuo = false;
        state.listTopic = action.payload;
        const map: Record<string, ITopic> = {};
        action.payload.forEach((t) => {
          map[t.id] = t;
        });
        state.mapTopic = map;
      })
      .addCase(getTopic.rejected, (state, action) => {
        state.loadHailuo = false;
        Notify({
          title: "Tải dữ liệu chủ đề lỗi!",
          status: "error",
        });
        console.error("Logout failed:", action.error);
      });
  },
});

export default LoginSlice.reducer;
