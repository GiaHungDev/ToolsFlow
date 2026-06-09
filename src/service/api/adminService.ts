import axiosClient from "@/lib/axiosClient";

export interface IFlowAccount {
  id: number;
  email: string;
  password?: string;
  twoFaCode?: string;
  cookies?: any;
  createdAt?: string;
  updatedAt?: string;
}

export interface IBasAccount {
  id: number;
  username: string;
  password?: string;
  staffCount?: number;
  createdAt?: string;
  updatedAt?: string;
  flowAccountId?: number | null;
  flowAccount?: IFlowAccount | null;
}

// FlowAccount CRUD
export const getFlowAccounts = async (): Promise<IFlowAccount[]> => {
  return await axiosClient.get<IFlowAccount[]>("/flow-account");
};

export const createFlowAccount = async (data: Partial<IFlowAccount>): Promise<IFlowAccount> => {
  return await axiosClient.post<IFlowAccount>("/flow-account", data);
};

export const updateFlowAccount = async (id: number, data: Partial<IFlowAccount>): Promise<IFlowAccount> => {
  return await axiosClient.patch<IFlowAccount>(`/flow-account/${id}`, data);
};

export const deleteFlowAccount = async (id: number): Promise<any> => {
  return await axiosClient.delete<any>(`/flow-account/${id}`);
};

// BasAccount CRUD
export const getBasAccounts = async (): Promise<IBasAccount[]> => {
  return await axiosClient.get<IBasAccount[]>("/bas");
};

export const createBasAccount = async (data: Partial<IBasAccount>): Promise<IBasAccount> => {
  return await axiosClient.post<IBasAccount>("/bas", data);
};

export const updateBasAccount = async (id: number, data: Partial<IBasAccount>): Promise<IBasAccount> => {
  return await axiosClient.patch<IBasAccount>(`/bas/${id}`, data);
};

export const deleteBasAccount = async (id: number): Promise<any> => {
  return await axiosClient.delete<any>(`/bas/${id}`);
};

export interface IAccountWeb {
  id: number;
  username: string;
  email: string;
  computerId?: string | null;
  knownDevices?: Record<string, { ip: string, last_login: string }>;
  role: string;
  isHeadless: boolean;
  createdAt?: string;
  groupId?: number | null;
  group?: { id: number; name: string; description?: string } | null;
}

export const getAutomationUsers = async (): Promise<IAccountWeb[]> => {
  return await axiosClient.get<IAccountWeb[]>("/user");
};

export const createAutomationUser = async (data: Partial<IAccountWeb>): Promise<IAccountWeb> => {
  return await axiosClient.post<IAccountWeb>("/user", data);
};

export const updateAutomationUser = async (id: number, data: Partial<IAccountWeb>): Promise<IAccountWeb> => {
  return await axiosClient.patch<IAccountWeb>(`/user/${id}`, data);
};

export const deleteAutomationUser = async (id: number): Promise<any> => {
  return await axiosClient.delete<any>(`/user/${id}`);
};

export const getUserStats = async (id: number): Promise<{ total: number; completed: number; failed: number; processing: number }> => {
  return await axiosClient.get(`/user/${id}/stats`);
};

// UserGroup CRUD
export interface IUserGroup {
  id: number;
  name: string;
  description?: string;
  createdAt?: string;
  _count?: {
    users: number;
  };
}

export const getGroups = async (): Promise<IUserGroup[]> => {
  return await axiosClient.get<IUserGroup[]>("/group");
};

export const createGroup = async (data: Partial<IUserGroup>): Promise<IUserGroup> => {
  return await axiosClient.post<IUserGroup>("/group", data);
};

export const updateGroup = async (id: number, data: Partial<IUserGroup>): Promise<IUserGroup> => {
  return await axiosClient.patch<IUserGroup>(`/group/${id}`, data);
};

export const deleteGroup = async (id: number): Promise<any> => {
  return await axiosClient.delete<any>(`/group/${id}`);
};

export const assignUserToGroup = async (userId: number, groupId: number | null): Promise<any> => {
  return await axiosClient.post<any>("/group/assign", { userId, groupId });
};

export const getAdminStats = async (params: { startDate?: string; endDate?: string; groupId?: number }): Promise<any> => {
  return await axiosClient.get("/admin/stats", { params });
};

export const exportAdminStats = async (params: { startDate?: string; endDate?: string; groupId?: number; period?: 'day' | 'week' | 'month' }): Promise<Blob> => {
  return await axiosClient.get("/admin/stats/export", {
    params,
    responseType: "blob"
  });
};


