import { TokenData, TokenStatus } from "./interface/LocalStore.interface";

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
