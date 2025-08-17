import { getLoginLinkService } from "@/service/api/authService";
import { removeAllToken, removeStoreLocal } from "./localStore";
import { Notify } from "@/lib/Notify";

/**
 * Tạo 1 helper function để xử lý lấy redirect đến trang đăng nhập
 * @param title - Tiêu đề của thông báo
 * @param description - nội dung mô tả thông báo
 * @param remove - trạng thái có clear localStorage hay không
 */
export const handleLoginRedirect = async (
  title: string,
  description: string,
  remove?: boolean
) => {
  try {
    // Call api lấy link đăng nhập
    const getLink = await getLoginLinkService(
      process.env.NEXT_PUBLIC_HOST_NAME_REDIRECT ?? window.location.origin
    );

    if (getLink?.url) {
      Notify({
        title: title,
        description: description,
        status: "warning",
      });

      if (remove) {
        removeAllToken();
        removeStoreLocal("account_web");
      }

      setTimeout(() => {
        const windowFeatures =
          "menubar=no,location=no,resizable=yes,scrollbars=yes,status=yes";
        window.open(getLink.url, "_parent", windowFeatures);
      }, 1500);
    } else {
      throw new Error("API không trả về login URL");
    }
  } catch (error: unknown) {
    Notify({
      title: "Lỗi",
      description: "Hãy liên hệ với admin",
      status: "error",
      actionLabel: "Thử lại",
      onAction: () => {
        window.location.reload();
      },
    });

    if (error instanceof Error) {
      console.error(`Failed to get login link: ${error.message}`);
    } else {
      console.error("Lỗi lấy link đăng nhập axiosClient");
    }
  }
};
