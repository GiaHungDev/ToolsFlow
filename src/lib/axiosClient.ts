import axios, { AxiosResponse, InternalAxiosRequestConfig, AxiosInstance, AxiosRequestConfig } from "axios";
import { TokenStatus } from "../utils/interface/LocalStore.interface";
import { checkToken, getStoreLocal, saveToken } from "../utils/localStore";
import { refreshTokenService } from "@/service/api/authService";

/**
 * Custom Axios Instance Interface
 * Override default Axios methods để trả về data thay vì AxiosResponse
 */
interface CustomAxiosInstance extends Omit<AxiosInstance, 'get' | 'post' | 'put' | 'delete' | 'patch' | 'request'> {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>;
  request<T = unknown>(config: AxiosRequestConfig): Promise<T>;
}

/**
 * Danh sách endpoint không yêu cầu kiểm tra token
 */
const urlCheck: string[] = [
  "/authen/verify",
  "/authen/refresh-token", 
  "/authen/logout",
  "/authen/login-link",
];

/**
 * Tạo một instance Axios dùng chung cho toàn bộ app
 */
const axiosClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    accept: "application/json",
    "User-Agent": `Payment-BO ${
      process.env.NEXT_PUBLIC_HOST_NAME_USER ?? "oke"
    }`,
  },
});

/**
 * Interceptor xử lý trước khi request được gửi đi
 */
const onRequest = async (
  config: InternalAxiosRequestConfig
): Promise<InternalAxiosRequestConfig> => {
  const token = getStoreLocal("access_token");

  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }

  if (config.url && urlCheck.includes(config.url)) {
    return config;
  }

  const status = checkToken();

  if (status === TokenStatus.TOKEN_VALID) {
    return config;
  }

  if (status === TokenStatus.EXPIRED_ACCESS_TOKEN) {
    const refresh = getStoreLocal("refresh_token");
    if (!refresh) {
      return Promise.reject("Không tìm thấy refresh token");
    }

    try {
      const newTokenData = await refreshTokenService(
        refresh,
        process.env.NEXT_PUBLIC_HOST_NAME_REDIRECT ?? ""
      );
      saveToken(newTokenData);

      // ✅ FIX: Sử dụng token mới, không phải token cũ
      config.headers.set("Authorization", `Bearer ${newTokenData.access_token}`);

      return config;
    } catch (error) {
      console.error("Refresh token failed:", error);
      return Promise.reject("Refresh token thất bại, vui lòng đăng nhập lại");
    }
  }

  if (
    status === TokenStatus.EXPIRED_REFRESH_TOKEN ||
    status === TokenStatus.NO_TOKEN
  ) {
    return Promise.reject("Phiên đăng nhập hết hạn, vui lòng đăng nhập lại");
  }

  return config;
};

/**
 * Xử lý lỗi trong request interceptor
 */
const onRequestError = (error: unknown) => {
  if (error instanceof Error) {
    return Promise.reject(error); // ✅ FIX: Thêm return
  }
  return Promise.reject(new Error("Unknown request error"));
};

/**
 * Interceptor xử lý response - luôn trả về response.data
 */
const onResponse = (response: AxiosResponse) => {
  return response.data;
};

/**
 * Xử lý lỗi trong response interceptor
 */
const onResponseError = (error: unknown) => {
  if (error instanceof Error) {
    return Promise.reject(error);
  }
  return Promise.reject(new Error("Unknown response error"));
};

// Gắn interceptors vào axiosClient
axiosClient.interceptors.request.use(onRequest, onRequestError);
axiosClient.interceptors.response.use(onResponse, onResponseError);

// ✅ Export với type definition mới
export default axiosClient as CustomAxiosInstance;