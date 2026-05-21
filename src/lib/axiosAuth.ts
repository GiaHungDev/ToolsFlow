import { getStoreLocal } from "@/utils/localStore";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";


interface AuthAxiosInstance
  extends Omit<
    AxiosInstance,
    "get" | "post" | "put" | "delete" | "patch" | "request"
  > {
  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  post<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T>;
  put<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T>;
  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T>;
  patch<T = unknown>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T>;
  request<T = unknown>(config: AxiosRequestConfig): Promise<T>;
}


const axiosAuth = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    accept: "application/json",
    "Content-Type": "application/json",
  },
});


axiosAuth.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error("Auth API error:", error);
    return Promise.reject(error);
  }
);


axiosAuth.interceptors.request.use(
  (config) => {
    const token = getStoreLocal("access_token");
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default axiosAuth as AuthAxiosInstance;
