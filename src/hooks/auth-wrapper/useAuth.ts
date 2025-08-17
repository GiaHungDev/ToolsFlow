import { checkMe } from "@/lib/redux/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useEffect, useState } from "react";

export const useAuth = (requireAuth: boolean) => {
  const dispatch = useAppDispatch();
  const { isLogin, loading, user } = useAppSelector((state) => state.auth);

  const [isInitialized, setIsInitialized] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        setIsChecking(true);

        if (requireAuth) {
          await dispatch(checkMe()).unwrap();
        }
      } catch (error) {
        console.error("Auth check failed:", error);
      } finally {
        setIsChecking(false);
        setIsInitialized(true);
      }
    };

    initializeAuth();
  }, [dispatch, requireAuth]);

  return {
    // redux
    isLogin,
    loading,
    user,

    // state
    isInitialized,
    isChecking,
  };
};
