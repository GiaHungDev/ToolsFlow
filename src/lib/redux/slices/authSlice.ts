import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import jwtDecode from "jwt-decode";
import {
  checkMeService,
  loginService,
  logoutService,
  refreshToken,
} from "../../service/api/loginService";

// ==== Interfaces ====
interface User {
  id: string;
  username: string;
  email?: string;
  role?: { name: string }[];
}

interface LoginPayload {
  code: string;
  redirectUri: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

interface JwtPayload {
  sub: string;
  exp?: number;
}

// ==== Async Thunks ====
export const checkMe = createAsyncThunk<
  User,
  { redirectUri: string },
  { rejectValue: string }
>("checkMe", async (data, thunkAPI) => {
  const access_token = getStoreLocal("access_token");
  const time_access = getStoreLocal("time_access");
  const refresh_token = getStoreLocal("refresh_token");
  const time_refresh = getStoreLocal("time_refresh");

  if (!access_token || !time_access || !refresh_token || !time_refresh) {
    return thunkAPI.rejectWithValue("Không thấy access token");
  }

  let decoded: JwtPayload;

  decoded = jwtDecode<JwtPayload>(access_token);

  if (parseInt(time_access) < Date.now()) {
    if (parseInt(time_refresh) < Date.now()) {
      return thunkAPI.rejectWithValue("Refresh Token hết hạn");
    }
    const resNewToken: TokenResponse = await refreshToken(
      refresh_token,
      data.redirectUri
    );
    decoded = jwtDecode<JwtPayload>(resNewToken?.access_token);
  }

  try {
    const resData = await checkMeService(decoded.sub);
    return resData;
  } catch (error: unknown) {
    if (error instanceof Error) {
      return thunkAPI.rejectWithValue(error.message);
    }
    return thunkAPI.rejectWithValue("Lỗi kiểm tra định danh!");
  }
});

export const login = createAsyncThunk<
  TokenResponse,
  { code: string; redirectUri: string }
>("login", async (data) => {
  const resData = await loginService({
    code: data.code,
    redirectUri: data.redirectUri,
  });
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
  user: User | null;
  loading: boolean;
  role: string[];
}

// ==== Initial State ====
const initialState: LoginState = {
  isLogin: false,
  user: null,
  loading: false,
  role: [],
};

// ==== Slice ====
export const LoginSlice = createSlice({
  name: "login",
  initialState,
  reducers: {
    logOut: (state) => {
      removeStoreLocal("access_token");
      removeStoreLocal("refresh_token");
      removeStoreLocal("time_refresh");
      removeStoreLocal("time_access");
      removeStoreLocal("keycloakId");
      state.isLogin = false;
      state.user = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // checkMe
      .addCase(checkMe.pending, (state) => {
        state.loading = true;
      })
      .addCase(checkMe.fulfilled, (state, action: PayloadAction<User>) => {
        state.loading = false;
        state.user = action.payload;
        localStorage.setItem("account_web", JSON.stringify(action.payload));
        state.isLogin = true;
      })
      .addCase(checkMe.rejected, (state, action) => {
        state.loading = false;
        console.log("Reject", action.payload);
      })
      // login
      .addCase(
        login.fulfilled,
        (state, action: PayloadAction<TokenResponse>) => {
          saveToken(action.payload);
        }
      )
      .addCase(login.rejected, () => {
        message.error(`Hệ thống đang có lỗi, vui lòng thử lại sau`);
      })
      // logout
      .addCase(logout.fulfilled, () => {
        // Có thể xử lý thêm khi logout thành công
      });
  },
});

export const { logOut } = LoginSlice.actions;
export default LoginSlice.reducer;
