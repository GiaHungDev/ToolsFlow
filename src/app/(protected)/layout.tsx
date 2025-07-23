import Header from "@/components/layout/Header";
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
    <div className="min-h-screen bg-white text-black">
      <Header />
      <main className="p-4">{children}</main>
    </div>
  );
}
