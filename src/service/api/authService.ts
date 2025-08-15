import axiosClient from "@/lib/axiosClient";
import { saveToken } from "../../utils/localStore";

/**
 * Lấy đường dẫn đăng nhập từ server
 * @param redirectUri - URL sẽ chuyển hướng sau khi đăng nhập
 * @returns Một string chứa link đăng nhập Keycloak (hoặc tương tự)
 */
export const getLoginLink = async (redirectUri: string): Promise<string> => {
  return axiosClient.get<string>("/authen/login-link", {
    params: { redirect_uri: redirectUri },
  });
};

/**
 * Làm mới access token khi token cũ hết hạn
 * @param refreshToken - Refresh token hiện tại
 * @param redirectUri - URL sẽ dùng cho luồng đăng nhập
 * @returns TokenData mới nhận được từ server
 */
export const refreshTokenService = async (
  refreshToken: string,
  redirectUri: string
): Promise<TokenData> => {
  const res = await axiosClient.post<TokenData>("/authen/refresh-token", {
    refreshToken,
    redirectUri,
  });
  // Lưu token mới vào localStorage
  saveToken(res);
  return res;
};

/**
 * Lấy thông tin người dùng từ server dựa trên userId
 * @param userId - ID người dùng
 * @returns Đối tượng User lấy từ API
 * @throws Error nếu gọi API thất bại
 */
export const checkMeService = async (userId: string): Promise<User> => {
  try {
    const res = await axiosClient.get<User>("/user/checkme", {
      params: { id: userId },
    });
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
 * @returns TokenData từ server
 */
export const loginService = async (data: {
  code: string;
  redirectUri: string;
}): Promise<TokenData> => {
  const res = await axiosClient.post<TokenData>("/authen/verify", data);
  return res;
};

/**
 * Gọi API để đăng xuất khỏi hệ thống
 * @param data - Gồm refresh token cần huỷ
 * @returns void
 */
export const logoutService = async (data: {
  refreshToken: string;
}): Promise<void> => {
  await axiosClient.post("/authen/logout", data);
};

/**
 * Gọi API để đổi mật khẩu của người dùng
 * @param id - ID người dùng
 * @param data - Gồm mật khẩu cũ và mật khẩu mới
 * @returns void
 */
export const changePasswordService = async (
  id: string,
  data: { oldPassword: string; newPassword: string }
): Promise<void> => {
  await axiosClient.patch(`/user/${id}`, data);
};
