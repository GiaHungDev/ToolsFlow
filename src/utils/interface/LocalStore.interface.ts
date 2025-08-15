// ==== Token Types ====
export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: string | number;
  refresh_expires_in: string | number;
}

export enum TokenStatus {
  NO_TOKEN = "NO_TOKEN",
  EXPIRED_REFRESH_TOKEN = "EXPIRED_REFRESH_TOKEN",
  EXPIRED_ACCESS_TOKEN = "EXPIRED_ACCESS_TOKEN",
  TOKEN_VALID = "TOKEN_VALID",
}
