import { handleLoginRedirect } from "@/utils/authHelper";
import { AuthResult, AuthStatus } from "@/utils/interface/LocalStore.interface";
import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import { checkAuth } from "../utils/localStore";
import { Notify } from "./Notify";

/**
 * Custom Axios Instance Interface
 * Override default Axios methods để trả về data thay vì AxiosResponse
 */
interface CustomAxiosInstance extends Omit<
  AxiosInstance,
  "get" | "post" | "put" | "delete" | "patch" | "request"
> {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T>;
  put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T>;
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T>;
  request<T = unknown>(config: AxiosRequestConfig): Promise<T>;
}

/**
 * Tạo một instance Axios dùng chung cho toàn bộ app
 */
const axiosClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    accept: "application/json",
    "Content-Type": "application/json",
  },
});

/**
 * Custom Error class cho auth redirect
 */
class AuthRedirectError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "AuthRedirectError";
  }
}

/**
 * Interceptor xử lý trước khi request được gửi đi
 */
const onRequest = async (
  config: InternalAxiosRequestConfig,
): Promise<InternalAxiosRequestConfig> => {
  try {
    const authResult: AuthResult = await checkAuth(
      process.env.NEXT_PUBLIC_HOST_NAME_REDIRECT ?? window.location.origin,
    );

    switch (authResult.status) {
      case AuthStatus.SUCCESS:
        if (authResult.access_token) {
          config.headers.set(
            "Authorization",
            `Bearer ${authResult.access_token}`,
          );
        }
        return config;

      case AuthStatus.NO_TOKEN:
        // Xử lý redirect và cancel request
        await handleLoginRedirect(
          "Hãy đăng nhập",
          "Hãy đăng nhập vào hệ thống để sử dụng dịch vụ",
        );
        throw new AuthRedirectError("User needs to login", "NO_TOKEN");

      case AuthStatus.SESSION_EXPIRED:
        await handleLoginRedirect(
          "Hãy đăng nhập lại",
          "Hết phiên đăng nhập, vui lòng đăng nhập lại hệ thống",
          true,
        );
        throw new AuthRedirectError("Session expired", "SESSION_EXPIRED");

      case AuthStatus.REFRESH_ERROR:
        await handleLoginRedirect(
          "Lỗi xác thực",
          "Có lỗi xảy ra khi làm mới token, vui lòng đăng nhập lại",
          true,
        );
        throw new AuthRedirectError("Refresh token failed", "REFRESH_ERROR");

      default:
        throw new Error("Lỗi xác thực không xác định");
    }
  } catch (error) {
    if (error instanceof AuthRedirectError) {
      throw error;
    }

    console.error("Auth check failed:", error);

    if (
      error instanceof Error &&
      error.message.includes("Failed to get login link")
    ) {
      throw error;
    }

    throw new Error("Lỗi kiểm tra xác thực");
  }
};

const onRequestError = (error: unknown) => {
  if (!(error instanceof AuthRedirectError)) {
    console.error("Request interceptor error:", error);
  }

  if (error instanceof Error) {
    return Promise.reject(error);
  }
  return Promise.reject(new Error("Unknown request error"));
};

const onResponse = (response: AxiosResponse) => {
  return response.data;
};

const onResponseError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const url = error.config?.url;

    switch (status) {
      case 401:
        console.warn("Unauthorized request to:", url);
        break;
      case 403:
        Notify({
          title: "Không có quyền truy cập",
          description: "Bạn không có quyền thực hiện hành động này",
          status: "error",
        });
        break;
      case 404:
        Notify({
          title: "Không tìm thấy",
          description: "Tài nguyên yêu cầu không tồn tại",
          status: "error",
        });
        break;
      case 500:
        Notify({
          title: "Lỗi server",
          description: "Có lỗi xảy ra từ phía server, vui lòng thử lại sau",
          status: "error",
        });
        break;
    }
  }

  if (error instanceof Error) {
    return Promise.reject(error);
  }
  return Promise.reject(new Error("Unknown response error"));
};

axiosClient.interceptors.request.use(onRequest, onRequestError);
axiosClient.interceptors.response.use(onResponse, onResponseError);

export default axiosClient as CustomAxiosInstance;
