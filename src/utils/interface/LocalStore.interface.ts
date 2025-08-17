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

// Enum để định nghĩa các trạng thái xác thực
export enum AuthStatus {
  SUCCESS = "SUCCESS", // Token hợp lệ
  NO_TOKEN = "NO_TOKEN", // Không có token nào
  SESSION_EXPIRED = "SESSION_EXPIRED", // Hết phiên đăng nhập
  REFRESH_ERROR = "REFRESH_ERROR", // Lỗi khi refresh token
}

// Interface cho kết quả trả về
export interface AuthResult {
  access_token: string | null;
  status: AuthStatus;
}
