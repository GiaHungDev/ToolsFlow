import { AIPlatform } from "@/components/sections/home/interface";
import { checkMe } from "@/lib/redux/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export const useCheck = () => {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const { isLogin, loading, user } = useAppSelector((state) => state.auth);

  useEffect(() => {
    if (!isLogin && !user) {
      dispatch(checkMe())
        .unwrap()
        .catch(() => {
          if (typeof window !== "undefined") {
            router.push("/home-landing");
          }
        });
    }
  }, [dispatch, router, isLogin, user]);

  const handleRedirectClick = (platform: AIPlatform) => {
    if (platform.key === "hailuo") {
      router.push("/hailuo-ai");
    } else {
      router.push("/runway-ai");
    }
  };

  return {
    handleRedirectClick,
    // redux
    isLogin,
    loading,
    user,
  };
};
