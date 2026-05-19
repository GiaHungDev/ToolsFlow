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

export interface IFlowVideo extends IBase {
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
  archiveStatus?: "Pending" | "Uploading" | "Archived" | "Failed";
  archiveError?: string | null;
  archiveAttempts?: number;
  archivedAt?: string | null;
  lockedAt?: string | null;
  s3Key?: string | null;
  sourceExpiresAt?: string | null;
}

export interface IPaginationFlow {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface IFlowData {
  data: IFlowVideo[];
  pagination: IPaginationFlow;
}

export interface CreateFlowVideo {
  thumbnail?: string;
  model: string;
  prompt: string;
  fileId?: string;
  formData?: FormData;
  topic: number;
}

export interface GetFlowVideo {
  page: number;
  limit: number;
  projectName?: string;
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


