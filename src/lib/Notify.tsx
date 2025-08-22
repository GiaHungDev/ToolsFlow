// src/lib/notify.ts
import { toast } from "sonner";

type ToastStatus = "success" | "error" | "warning" | "info";

interface NotifyOptions {
  title: string;
  description?: string;
  status?: ToastStatus;
  actionLabel?: string;
  onAction?: () => void;
}

export function Notify({
  title,
  description,
  status = "info",
  actionLabel,
  onAction,
}: NotifyOptions) {
  // Cách 1: Sử dụng built-in toast types của Sonner
  const toastOptions = {
    description,
    action:
      actionLabel && onAction
        ? {
            label: actionLabel,
            onClick: onAction,
          }
        : undefined,
  };

  switch (status) {
    case "success":
      toast.success(title, toastOptions);
      break;
    case "error":
      toast.error(title, toastOptions);
      break;
    case "warning":
      toast.warning(title, toastOptions);
      break;
    case "info":
    default:
      toast.info(title, toastOptions);
      break;
  }
}
