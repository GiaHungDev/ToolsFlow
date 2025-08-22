import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Notify } from "@/lib/Notify";
import { createTopicService } from "@/service/api/hailuoService";
import { ITopic } from "@/types/hailuo";

// ==== Async Thunks ====
export const createTopic = createAsyncThunk<
  ITopic,
  { title: string; prompt: string }
>("createTopic", async ({ title, prompt }) => {
  const resData = await createTopicService(title, prompt);
  return resData;
});

interface IState {
  loadHailuo: boolean;
  topic: ITopic;
}

// ==== Initial State ====
const initialState: IState = {
  loadHailuo: false,
  topic: {} as ITopic,
};

// ==== Slice ====
export const LoginSlice = createSlice({
  name: "hailuo",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      // logout
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
      });
  },
});

export default LoginSlice.reducer;
