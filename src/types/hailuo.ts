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

export interface IHailuoVideo extends IBase {
  accountId: string;
  status: string;
  thumbnail: string;
  model: string;
  fileId: string;
  videoURL: string;
  videoId: string;
  type: string;
  isDownloaded: boolean;
  ownerId: number;
  title: string;
  email: string;
  description: string;
  imageBase64: string;
  prompt: string;
}

export interface IPaginationHailuo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface IHailuoData {
  data: IHailuoVideo[];
  pagination: IPaginationHailuo;
}

export interface CreateHailuoVideo {
  thumbnail?: string;
  model: string;
  prompt: string;
  fileId?: string;
  formData?: FormData;
  topic: number;
}

export interface GetHailuoVideo {
  page: number;
  limit: number;
  description?: string;
  topic?: number;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface IFilesUpload {
  ossPath: string;
  fileID: string;
}

export interface IPromptItem {
  id: string;
  content: string;
}
