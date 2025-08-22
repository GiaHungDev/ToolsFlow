import { checkMe } from "@/lib/redux/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export const useAuth = (requireAuth: boolean) => {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();

  const { isLogin, loading, user } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (pathname === "/") return;

    if (!isLogin && !user) {
      if (requireAuth) {
        dispatch(checkMe())
          .unwrap()
          .catch(() => {
            if (typeof window !== "undefined") {
              router.push("/home-landing");
            }
          });
      }
    }
  }, [dispatch, requireAuth, router, isLogin, user, pathname]);

  return {
    // redux
    isLogin,
    loading,
    user,
  };
};
