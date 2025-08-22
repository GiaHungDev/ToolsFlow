import { Notify } from "@/lib/Notify";
import { removeAllToken, removeStoreLocal } from "./localStore";

/**
 * Tạo 1 helper function để xử lý lấy redirect đến trang đăng nhập
 * @param title - Tiêu đề của thông báo
 * @param description - nội dung mô tả thông báo
 * @param remove - trạng thái có clear localStorage hay không
 * @param delay - thời gian delay trước khi redirect (mặc định 1500ms)
 */
export const handleLoginRedirect = async (
  title: string,
  description: string,
  remove?: boolean,
  delay: number = 1500
): Promise<void> => {
  try {
    // Hiển thị thông báo
    Notify({
      title: title,
      description: description,
      status: "warning",
    });

    // Clear storage nếu cần
    if (remove) {
      removeAllToken();
      removeStoreLocal("account_web");
    }

    // Redirect sau delay
    setTimeout(() => {
      window.location.href = "/home-landing";
    }, delay);

    // Return Promise resolve để có thể await
    return new Promise((resolve) => {
      setTimeout(resolve, delay + 100);
    });
  } catch (error: unknown) {
    // Xử lý lỗi trong quá trình redirect
    Notify({
      title: "Lỗi",
      description: "Có lỗi xảy ra khi chuyển hướng. Hãy liên hệ với admin",
      status: "error",
      actionLabel: "Thử lại",
      onAction: () => {
        window.location.reload();
      },
    });

    if (error instanceof Error) {
      console.error(`Failed to handle login redirect: ${error.message}`);
      // Throw lại error để interceptor có thể handle
      throw new Error(`Failed to get login link: ${error.message}`);
    } else {
      console.error("Lỗi redirect đăng nhập");
      throw new Error("Failed to get login link: Unknown error");
    }
  }
};
