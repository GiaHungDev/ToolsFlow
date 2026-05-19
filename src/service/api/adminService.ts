import axiosAuth from "@/lib/axiosAuth";

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
  return await axiosAuth.get<IFlowAccount[]>("/flow-account");
};

export const createFlowAccount = async (data: Partial<IFlowAccount>): Promise<IFlowAccount> => {
  return await axiosAuth.post<IFlowAccount>("/flow-account", data);
};

export const updateFlowAccount = async (id: number, data: Partial<IFlowAccount>): Promise<IFlowAccount> => {
  return await axiosAuth.patch<IFlowAccount>(`/flow-account/${id}`, data);
};

export const deleteFlowAccount = async (id: number): Promise<any> => {
  return await axiosAuth.delete<any>(`/flow-account/${id}`);
};

// BasAccount CRUD
export const getBasAccounts = async (): Promise<IBasAccount[]> => {
  return await axiosAuth.get<IBasAccount[]>("/bas");
};

export const createBasAccount = async (data: Partial<IBasAccount>): Promise<IBasAccount> => {
  return await axiosAuth.post<IBasAccount>("/bas", data);
};

export const updateBasAccount = async (id: number, data: Partial<IBasAccount>): Promise<IBasAccount> => {
  return await axiosAuth.patch<IBasAccount>(`/bas/${id}`, data);
};

export const deleteBasAccount = async (id: number): Promise<any> => {
  return await axiosAuth.delete<any>(`/bas/${id}`);
};
