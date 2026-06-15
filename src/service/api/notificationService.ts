import axiosClient from "@/lib/axiosClient";

export interface INotification {
  id: number;
  title: string;
  content: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const getNotificationsService = async (
  activeOnly?: boolean
): Promise<INotification[]> => {
  const res: any = await axiosClient.get(
    `/notification${activeOnly ? "?active=true" : ""}`
  );
  return res;
};

export const createNotificationService = async (data: {
  title: string;
  content: string;
  isActive: boolean;
}): Promise<INotification> => {
  const res: any = await axiosClient.post("/notification", data);
  return res;
};

export const updateNotificationService = async (
  id: number,
  data: Partial<{
    title: string;
    content: string;
    isActive: boolean;
  }>
): Promise<INotification> => {
  const res: any = await axiosClient.patch(`/notification/${id}`, data);
  return res;
};

export const deleteNotificationService = async (id: number): Promise<void> => {
  await axiosClient.delete(`/notification/${id}`);
};
