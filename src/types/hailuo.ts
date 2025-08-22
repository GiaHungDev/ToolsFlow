import { IBase } from "./baseInterface";

// interface
export interface ITopic extends IBase {
  title: string;
  description: string;
  keywords: string;
  accountId: number;
  prompt: string;
}
