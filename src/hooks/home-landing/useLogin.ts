import { Notify } from "@/lib/Notify";
import { checkMe, login } from "@/lib/redux/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { getLoginLinkService } from "@/service/api/authService";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export const useLogin = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useAppDispatch();
  const redirectUri = process.env.NEXT_PUBLIC_HOST_NAME_REDIRECT;

  const { user, loading } = useAppSelector((state) => state.auth);

  useEffect(() => {
    const code = searchParams.get("code");

    if (code && redirectUri) {
      // Case 1: Có code - Login flow
      dispatch(login({ code, redirectUri }))
        .unwrap()
        .then(() => {
          return dispatch(checkMe()).unwrap();
        })
        .then(() => {
          router.push("/");
        })
        .catch((error) => {
          console.error("❌ Login failed:", error);
          Notify({
            title: "Lỗi đăng nhập",
            description: "Không thể đăng nhập, vui lòng thử lại",
            status: "error",
          });
        });
    }
  }, [searchParams, dispatch, redirectUri, router]);

  const handleLogin = async () => {
    try {
      if (!redirectUri) {
        console.error("Redirect URI is not defined");
        return;
      }

      const { url } = await getLoginLinkService(redirectUri);
      window.location.href = url;
    } catch (error: unknown) {
      console.error("Get login link error:", error);
      const des =
        error instanceof Error
          ? error.message
          : "Không thể kết nối đến server, vui lòng thử lại sau";

      Notify({
        title: "Lỗi đăng nhập",
        description: des,
        status: "error",
      });
    }
  };

  return {
    handleLogin,
    // redux
    user,
    loading,
    // state
  };
};
