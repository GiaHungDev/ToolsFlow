import Header from "@/components/layout/Header";
import AuthWrapper from "@/components/sections/auth-wrapper";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Harumi AI – Dashboard",
  description: "Khu vực sử dụng đã đăng nhập",
};

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthWrapper requireAuth>
      <div className="min-h-screen bg-white text-black">
        <Header />
        <div className="pt-20 px-2">{children}</div>
      </div>
    </AuthWrapper>
  );
}
