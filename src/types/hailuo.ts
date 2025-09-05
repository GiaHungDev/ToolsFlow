import { IBase } from "./baseInterface";

// interface
export interface ITopic extends IBase {
  title: string;
  description: string;
  keywords: string;
  accountId: number;
  prompt: string;
}

export interface IPrompt {
  prompt: string;
}

export interface IHailuoVideo {
  accountId: string;
  status: string | null;
  thumbnail: string | null;
  model: string | null;
  fileId: string | null;
  videoURL: string | null;
  videoId: string | null;
  type: string | null;
  isDownloaded: boolean | null;
  ownerId: number;
  title: string | null;
  email: string | null;
  description: string | null;
  imageBase64: string | null;
}

export interface CreateHailuoVideo {
  thumbnail: string;
  model: string;
  prompt: string;
  fileId?: string;
  formData?: FormData;
}

export interface IFilesUpload {
  ossPath: string;
  fileID: string;
}
