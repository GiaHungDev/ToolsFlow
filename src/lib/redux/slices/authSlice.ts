import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Notify } from "@/lib/Notify";
import {
  checkMeService,
  loginService,
  logoutService,
} from "@/service/api/authService";
import { ITokenData } from "@/types/auth";
import { IUser } from "@/types/user";
import { AuthResult, AuthStatus } from "@/utils/interface/LocalStore.interface";
import {
  checkAuth,
  removeAllToken,
  removeStoreLocal,
  saveToken,
} from "@/utils/localStore";

// ==== Async Thunks ====
export const checkMe = createAsyncThunk<IUser, void, { rejectValue: string }>(
  "checkMe",
  async (_, thunkAPI) => {
    try {
      const authResult: AuthResult = await checkAuth(
        process.env.NEXT_PUBLIC_HOST_NAME_REDIRECT ?? window.location.origin
      );

      if (
        !authResult.access_token &&
        authResult.status !== AuthStatus.SUCCESS
      ) {
        Notify({
          title: "Hết phiên đăng nhập",
          description: "Hãy đăng nhập lại để xử dụng hệ thống",
          status: "warning",
        });
        throw new Error(`CheckMe error: ${AuthStatus.SESSION_EXPIRED}`);
      }

      const userData = await checkMeService();
      return userData;
    } catch (error: unknown) {
      console.error("CheckMe error:", error);

      // Kiểm tra loại lỗi cụ thể
      if (error instanceof Error) {
        return thunkAPI.rejectWithValue(error.message);
      }

      return thunkAPI.rejectWithValue("Lỗi kiểm tra định danh không xác định");
    }
  }
);

export const login = createAsyncThunk<
  ITokenData,
  any
>("login", async (data) => {
  const resData = await loginService(data);
  return resData;
});

export const logout = createAsyncThunk<unknown, { refreshToken: string }>(
  "logout",
  async ({ refreshToken }) => {
    const resData = await logoutService({ refreshToken });
    return resData;
  }
);

interface LoginState {
  isLogin: boolean;
  isLoggingOut: boolean;
  user: IUser | null;
  loading: boolean;
  authError?: string;
}

// ==== Initial State ====
const initialState: LoginState = {
  isLogin: false,
  isLoggingOut: false,
  user: null,
  loading: false,
  authError: undefined,
};

// ==== Slice ====
export const LoginSlice = createSlice({
  name: "login",
  initialState,
  reducers: {
    clearAuthError: (state) => {
      state.authError = undefined;
    },
  },
  extraReducers: (builder) => {
    builder
      // checkMe
      .addCase(checkMe.pending, (state) => {
        state.loading = true;
        state.authError = undefined;
      })
      .addCase(checkMe.fulfilled, (state, action: PayloadAction<IUser>) => {
        state.loading = false;
        state.user = action.payload;
        state.isLogin = true;
        state.authError = undefined;

        // Lưu thông tin user vào localStorage
        localStorage.setItem("account_web", JSON.stringify(action.payload));
      })
      .addCase(checkMe.rejected, (state, action) => {
        state.loading = false;
        state.isLogin = false;
        state.user = null;
        state.authError = action.payload;
      })
      // login
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.authError = undefined;
      })
      .addCase(login.fulfilled, (state, action: PayloadAction<ITokenData>) => {
        state.loading = false;
        saveToken(action.payload);
        state.authError = undefined;

        // Thông báo đăng nhập thành công
        Notify({
          title: "Đăng nhập thành công",
          description: "Chào mừng bạn quay trở lại!",
          status: "success",
        });
      })
      .addCase(login.rejected, (state, action) => {
        state.loading = false;
        state.authError = "Đăng nhập thất bại";
        console.error("Login failed:", action.error);
      })
      // logout
      .addCase(logout.pending, (state) => {
        state.isLoggingOut = true;
      })
      .addCase(logout.fulfilled, (state) => {
        state.isLoggingOut = false;
        state.isLogin = false;
        state.user = null;
        state.authError = undefined;
        removeAllToken();
        removeStoreLocal("account_web");

        // Thông báo đăng xuất thành công
        Notify({
          title: "Đăng xuất thành công",
          description: "Cảm ơn bạn đã sử dụng dịch vụ",
          status: "success",
        });
      })
      .addCase(logout.rejected, (state, action) => {
        state.loading = false;
        // Vẫn clear state local dù API logout failed
        state.isLoggingOut = false;
        state.user = null;
        state.authError = undefined;
        removeAllToken();
        removeStoreLocal("account_web");

        // Thông báo lỗi nhưng vẫn đăng xuất local
        Notify({
          title: "Có lỗi khi đăng xuất",
          description:
            "Đã đăng xuất khỏi thiết bị này, nhưng có thể cần đăng xuất thủ công ở các thiết bị khác",
          status: "warning",
        });

        console.error("Logout failed:", action.error);
      });
  },
});

export const { clearAuthError } = LoginSlice.actions;
export default LoginSlice.reducer;
