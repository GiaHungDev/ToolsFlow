import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";


interface CustomAxiosBase
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

const axiosBase = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  headers: {
    accept: "application/json",
    "Content-Type": "application/json",
  },
});


axiosBase.interceptors.response.use(
  (response: AxiosResponse) => response.data,
  (error) => {
    if (error instanceof Error) {
      return Promise.reject(error);
    }
    return Promise.reject(new Error("Unknown base axios error"));
  }
);

export default axiosBase as CustomAxiosBase;
