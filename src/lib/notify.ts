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

export function notify({
  title,
  description,
  status = "info",
  actionLabel,
  onAction,
}: NotifyOptions) {
  const statusIcon = {
    success: "✅",
    error: "❌",
    warning: "⚠️",
    info: "ℹ️",
  };

  toast(`${statusIcon[status]} ${title}`, {
    description,
    action:
      actionLabel && onAction
        ? {
            label: actionLabel,
            onClick: onAction,
          }
        : undefined,
  });
}
