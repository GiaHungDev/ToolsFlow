import { refreshTokenService } from "@/service/api/authService";
import {
  AuthResult,
  AuthStatus,
  TokenData,
  TokenStatus,
} from "./interface/LocalStore.interface";

// ==== Local Storage Helpers ====
export const getStoreLocal = (item: string): string | null => {
  if (typeof window !== "undefined") {
    return localStorage.getItem(item);
  }
  return null;
};

export const removeStoreLocal = (item: string): void => {
  if (typeof window !== "undefined") {
    localStorage.removeItem(item);
  }
};

/**
 * Hàm xoá tất cả token trong localStorage
 */
export const removeAllToken = () => {
  if (typeof window !== "undefined") {
    for (const key of [
      "access_token",
      "refresh_token",
      "time_refresh",
      "time_access",
    ]) {
      localStorage.removeItem(key);
    }
  }
};

export const setStoreLocal = (item: string, value: string): void => {
  if (typeof window !== "undefined") {
    localStorage.setItem(item, value);
  }
};

// ==== Save Token ====
export const saveToken = (resData: TokenData): void => {
  const { access_token, expires_in, refresh_expires_in, refresh_token } =
    resData;

  setStoreLocal("access_token", access_token);
  setStoreLocal("refresh_token", refresh_token);

  const timeAccess = Date.now() + Number(expires_in) * 1000;
  const timeRefresh = Date.now() + Number(refresh_expires_in) * 1000;

  setStoreLocal("time_access", timeAccess.toString());
  setStoreLocal("time_refresh", timeRefresh.toString());
};

// ==== Check Token ====
export const checkToken = (): TokenStatus => {
  const access_token = getStoreLocal("access_token");
  const time_access = getStoreLocal("time_access");
  const refresh_token = getStoreLocal("refresh_token");
  const time_refresh = getStoreLocal("time_refresh");

  if (!access_token || !time_access || !refresh_token || !time_refresh) {
    return TokenStatus.NO_TOKEN;
  }

  if (parseInt(time_access) < Date.now()) {
    if (parseInt(time_refresh) < Date.now()) {
      return TokenStatus.EXPIRED_REFRESH_TOKEN;
    }
    return TokenStatus.EXPIRED_ACCESS_TOKEN;
  }

  return TokenStatus.TOKEN_VALID;
};

/**
 * Kiểm tra và đảm bảo có access token hợp lệ
 * Tự động làm mới token nếu cần thiết
 * @param redirectUri - URL redirect để sử dụng khi refresh token
 * @returns Promise<AuthResult> - Kết quả chứa access_token và status
 */
export const checkAuth = async (redirectUri: string): Promise<AuthResult> => {
  const access_token = getStoreLocal("access_token");
  const time_access = getStoreLocal("time_access");
  const refresh_token = getStoreLocal("refresh_token");
  const time_refresh = getStoreLocal("time_refresh");

  // Trường hợp 1: Không có token nào trong localStorage
  if (!access_token || !time_access || !refresh_token || !time_refresh) {
    return {
      access_token: null,
      status: AuthStatus.NO_TOKEN,
    };
  }

  // Trường hợp 2: Kiểm tra access_token còn hiệu lực
  const accessTokenExpiry = parseInt(time_access);
  if (accessTokenExpiry > Date.now()) {
    // Access token còn hiệu lực, trả về luôn
    return {
      access_token,
      status: AuthStatus.SUCCESS,
    };
  }

  // Trường hợp 3: Access token hết hạn, kiểm tra refresh_token
  const refreshTokenExpiry = parseInt(time_refresh);
  if (refreshTokenExpiry > Date.now()) {
    try {
      // Refresh token còn hiệu lực, gọi API để làm mới
      const newTokenData = await refreshTokenService(
        refresh_token,
        redirectUri
      );

      // Lưu token mới vào localStorage
      saveToken(newTokenData);

      // Trả về access_token mới
      return {
        access_token: newTokenData.access_token,
        status: AuthStatus.SUCCESS,
      };
    } catch (error) {
      console.error("Error refreshing token:", error);
      return {
        access_token: null,
        status: AuthStatus.REFRESH_ERROR,
      };
    }
  }

  // Trường hợp 4: Cả access_token và refresh_token đều hết hạn
  return {
    access_token: null,
    status: AuthStatus.SESSION_EXPIRED,
  };
};
