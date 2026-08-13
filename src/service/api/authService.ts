import axiosClient from "@/lib/axiosClient";
import { saveToken } from "../../utils/localStore";
import { ITokenData } from "@/types/auth";
import { IUser } from "@/types/user";
import axiosBase from "@/lib/axiosBase";
import axiosAuth from "@/lib/axiosAuth";
import axios from "axios";

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
    let authRes: any = null;
    const isAdmin = data.username === "admin";

    if (!isAdmin) {
      // 1. Xác thực qua Server Tổng (Auth API)
      const authUrl = process.env.NEXT_PUBLIC_AUTH_API_URL;
      const payload = { ...data, toolKey: "123456789" };
      const authResponse = await axios.post(`${authUrl}/auth/login-tool`, payload, {
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      authRes = authResponse.data;

      if (authRes && authRes.success === false) {
        throw new Error(
          authRes.message || "Tài khoản hoặc mật khẩu không chính xác tại Server Tổng.",
        );
      }
    } else {
      // Cấp phát computerId mặc định cho admin nếu bị rỗng để tránh lỗi class-validator ở Backend
      if (!data.computerId) {
        data.computerId = "ADMIN-DEVICE";
      }
    }

    // 2. Tiếp tục xác thực và kiểm tra DB tại Local Backend
    // Lưu ý: axiosBase đã được config interceptor tự động trả về response.data
    const localRes: any = await axiosBase.post("/user/login-device", data);

    if (localRes && localRes.success === false) {
      throw new Error(
        localRes.message || "Lỗi xác thực thiết bị từ hệ thống nội bộ.",
      );
    }

    // Ưu tiên sử dụng access_token từ Local Backend để gọi các API nội bộ sau này
    const finalToken = localRes?.access_token || authRes?.access_token;

    if (finalToken) {
      return {
        access_token: finalToken,
        expires_in: 3600 * 24, // 24h
        refresh_token: finalToken,
        refresh_expires_in: 3600 * 24 * 7,
      };
    }

    throw new Error("Lỗi định dạng phản hồi từ máy chủ");
  } catch (error: any) {
    // Xử lý lỗi trả về từ Axios
    if (error.response && error.response.data && error.response.data.message) {
      const serverMsg = error.response.data.message;
      // Dịch các lỗi tiếng Anh từ Server Tổng sang tiếng Việt
      if (typeof serverMsg === 'string') {
        const msgLower = serverMsg.toLowerCase();
        if (msgLower.includes("invalid computer")) {
          throw new Error("Mã thiết bị (Computer ID) không trùng khớp với thiết bị đã đăng ký.");
        }
        if (msgLower.includes("invalid user credentials") || msgLower.includes("invalid credentials") || msgLower.includes("invalid username")) {
          throw new Error("Tài khoản hoặc mật khẩu không chính xác.");
        }
      }
      throw new Error(serverMsg);
    }
    if (error.response?.status === 401) {
      throw new Error("Tài khoản hoặc mật khẩu không chính xác.");
    }
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
