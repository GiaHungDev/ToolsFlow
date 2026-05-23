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

// Automation User CRUD (AccountWeb)
export interface IAccountWeb {
  id: number;
  username: string;
  email: string;
  computerId?: string | null;
  knownDevices?: Record<string, { ip: string, last_login: string }>;
  role: string;
  isHeadless: boolean;
  createdAt?: string;
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
