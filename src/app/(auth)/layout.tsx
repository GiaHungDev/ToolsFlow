import type { Metadata } from "next";

import packageJson from "../../../package.json";

export const metadata: Metadata = {
  title: `Harumi AI v${packageJson.version} – Dashboard`,
  description: "Landing page giới thiệu web",
};

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-white text-black">{children}</div>;
}
