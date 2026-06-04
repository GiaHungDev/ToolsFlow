import { IBase } from "./baseInterface";

// Interface
export interface IUser extends IBase {
  username: string;
  password: string;
  email: string;
  role?: string;
  isHeadless?: boolean;
}
