"use client";

import { useAuth } from "@/hooks/auth-wrapper/useAuth";
import { AuthWrapperProps } from "./interface";

export default function AuthWrapper({
  children,
  requireAuth = true,
  fallbackComponent,
  showLoadingSpinner = true,
}: AuthWrapperProps) {
  const { isLogin, loading, user, isInitialized, isChecking } =
    useAuth(requireAuth);

  // Loading state
  if ((isChecking || loading || !isInitialized) && showLoadingSpinner) {
    if (fallbackComponent) {
      return <>{fallbackComponent}</>;
    }

    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-medium text-gray-800 mb-2">
            Đang kiểm tra thông tin đăng nhập
          </h3>
          <p className="text-gray-600 text-sm">
            Vui lòng đợi trong giây lát...
          </p>
        </div>
      </div>
    );
  }

  // Nếu không yêu cầu auth, render luôn
  if (!requireAuth) {
    return <>{children}</>;
  }

  // Nếu yêu cầu auth và đã login, render children
  if (requireAuth && isLogin && user) {
    return <>{children}</>;
  }

  // Fallback - có thể là đang trong quá trình redirect
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center max-w-md mx-auto p-6">
        <div className="animate-pulse w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4"></div>
        <p className="text-gray-600 text-sm">Đang chuyển hướng...</p>
      </div>
    </div>
  );
}
