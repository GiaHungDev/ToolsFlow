"use client";

import { logout } from "@/lib/redux/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useRouter } from "next/navigation";

export const useHeaderControl = () => {
  const dispatch = useAppDispatch();
  const router = useRouter();

  const { user } = useAppSelector((state) => state.auth);

  const handleLogout = async () => {
    try {
      const refreshToken =
        typeof window !== "undefined"
          ? localStorage.getItem("refresh_token")
          : null;

      if (!refreshToken) {
        console.warn("Không tìm thấy refresh token, logout local luôn.");
        router.push("/home-landing");
        return;
      }

      await dispatch(logout({ refreshToken })).unwrap();
      router.push("/home-landing");
    } catch (e) {
      console.error("Logout error:", e);
      router.push("/home-landing"); // fallback
    }
  };

  return {
    user,
    handleLogout,
  };
};
