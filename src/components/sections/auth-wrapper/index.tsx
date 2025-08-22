"use client";

import { useAuth } from "@/hooks/auth-wrapper/useAuth";
import { AuthWrapperProps } from "./interface";
import Loading from "@/app/loading";

export default function AuthWrapper({
  children,
  requireAuth = true,
}: AuthWrapperProps) {
  const { loading, isLogin, user } = useAuth(requireAuth);

  // Loading state
  if (loading) {
    <Loading />;
  }

  // Nếu không yêu cầu auth
  if (!requireAuth) {
    return <>{children}</>;
  }

  // Nếu đã login thành công
  if (requireAuth && isLogin && user) {
    return <>{children}</>;
  }

  return <>{children}</>;
}
