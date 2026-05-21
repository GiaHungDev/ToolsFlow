import axiosClient from "@/lib/axiosClient";
import { saveToken } from "../../utils/localStore";
import { ITokenData } from "@/types/auth";
import { IUser } from "@/types/user";
import axiosBase from "@/lib/axiosBase";
import axiosAuth from "@/lib/axiosAuth";

export const refreshTokenService = async (
  refreshToken: string,
  redirectUri: string,
): Promise<ITokenData> => {
  try {
    const res = await axiosBase.post<ITokenData>("/authen/refresh-token", {
      refreshToken,
      redirectUri,
    });

    saveToken(res);
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error refreshing token: " + error.message);
    }
    throw new Error("Error refreshing token: Unknown error");
  }
};

export const checkMeService = async (): Promise<IUser> => {
  try {
    const res = await axiosAuth.get<IUser>("/user/checkme");
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error checking user: " + error.message);
    }
    throw new Error("Error checking user: Unknown error");
  }
};

export const loginService = async (data: any): Promise<ITokenData> => {
  try {
    const res: any = await axiosBase.post("/user/login-device", data);

    if (res && res.success === false) {
      throw new Error(
        res.message || "Tài khoản hoặc mật khẩu không chính xác.",
      );
    }

    if (res && res.access_token) {
      return {
        access_token: res.access_token,
        expires_in: 3600 * 24, // 24h
        refresh_token: res.access_token,
        refresh_expires_in: 3600 * 24 * 7,
      };
    }

    throw new Error("Lỗi định dạng phản hồi từ máy chủ");
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Lỗi không xác định khi đăng nhập");
  }
};

export const logoutService = async (data: {
  refreshToken: string;
}): Promise<void> => {
  try {
    await axiosClient.post("/authen/logout", data);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error during logout: " + error.message);
    }
    throw new Error("Error during logout: Unknown error");
  }
};

export const changePasswordService = async (
  id: string,
  data: { oldPassword: string; newPassword: string },
): Promise<void> => {
  try {
    await axiosClient.patch(`/user/${id}`, data);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error changing password: " + error.message);
    }
    throw new Error("Error changing password: Unknown error");
  }
};
