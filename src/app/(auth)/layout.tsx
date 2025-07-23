import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Harumi AI – Login",
  description: "Khu vực sử dụng để đăng nhập",
};

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-black">
      <main className="p-4">{children}</main>
    </div>
  );
}
