// Interface
export interface ITokenData {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

export interface ILoginLink {
  url: string;
}
