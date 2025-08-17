import axiosClient from "@/lib/axiosClient";
import { saveToken } from "../../utils/localStore";
import { ILoginLink, ITokenData } from "@/types/auth";
import { IUser } from "@/types/user";
import axiosBase from "@/lib/axiosBase";

/**
 * Lấy đường dẫn đăng nhập từ server
 * @param redirectUri - URL sẽ chuyển hướng sau khi đăng nhập
 * @returns Một string chứa link đăng nhập Keycloak (hoặc tương tự)
 * @throws Error nếu gọi API thất bại
 */
export const getLoginLinkService = async (
  redirectUri: string
): Promise<ILoginLink> => {
  try {
    return await axiosBase.get<ILoginLink>("/authen/login-link", {
      params: { redirect_uri: redirectUri },
    });
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error getting login link: " + error.message);
    }
    throw new Error("Error getting login link: Unknown error");
  }
};

/**
 * Làm mới access token khi token cũ hết hạn
 * @param refreshToken - Refresh token hiện tại
 * @param redirectUri - URL sẽ dùng cho luồng đăng nhập
 * @returns ITokenData mới nhận được từ server
 * @throws Error nếu gọi API thất bại
 */
export const refreshTokenService = async (
  refreshToken: string,
  redirectUri: string
): Promise<ITokenData> => {
  try {
    const res = await axiosBase.post<ITokenData>("/authen/refresh-token", {
      refreshToken,
      redirectUri,
    });
    // Lưu token mới vào localStorage
    saveToken(res);
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error refreshing token: " + error.message);
    }
    throw new Error("Error refreshing token: Unknown error");
  }
};

/**
 * Lấy thông tin người dùng từ server dựa trên userId
 * @param userId - ID người dùng
 * @returns Đối tượng User lấy từ API
 * @throws Error nếu gọi API thất bại
 */
export const checkMeService = async (): Promise<IUser> => {
  try {
    const res = await axiosClient.get<IUser>("/user/checkme");
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error checking user: " + error.message);
    }
    throw new Error("Error checking user: Unknown error");
  }
};

/**
 * Gọi API xác thực để lấy access token và refresh token
 * @param data - Gồm mã code (OAuth) và redirectUri
 * @returns ITokenData từ server
 * @throws Error nếu gọi API thất bại
 */
export const loginService = async (data: {
  code: string;
  redirectUri: string;
}): Promise<ITokenData> => {
  try {
    const res = await axiosBase.post<ITokenData>("/authen/verify", data);
    return res;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error("Error during login: " + error.message);
    }
    throw new Error("Error during login: Unknown error");
  }
};

/**
 * Gọi API để đăng xuất khỏi hệ thống
 * @param data - Gồm refresh token cần huỷ
 * @returns void
 * @throws Error nếu gọi API thất bại
 */
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

/**
 * Gọi API để đổi mật khẩu của người dùng
 * @param id - ID người dùng
 * @param data - Gồm mật khẩu cũ và mật khẩu mới
 * @returns void
 * @throws Error nếu gọi API thất bại
 */
export const changePasswordService = async (
  id: string,
  data: { oldPassword: string; newPassword: string }
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
