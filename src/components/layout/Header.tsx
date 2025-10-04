"use client";

import { useHeaderControl } from "@/hooks/header/useHeaderControl";
import { LogOut, User } from "lucide-react";
import UserProfileSheet from "../sections/user-profile/UserProfileSheet";
import { CSheet } from "../shared/CSheet";
import { Button } from "../ui/button";
import { SheetClose } from "../ui/sheet";

export default function Header() {
  const { user, handleLogout } = useHeaderControl();

  return (
    <header className="fixed top-0 left-0 z-50 w-full bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-full mx-auto px-4 sm:px-4 lg:px-6">
        <div className="flex justify-between items-center h-16">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center space-x-1">
            {/* Logo */}
            <div className="flex items-center space-x-2 pr-4">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="text-base font-semibold text-gray-900 hidden sm:block">
                FLOW-AI
              </span>
            </div>

            {/* <div className="flex items-center space-x-2">
              <Button variant="ghost">Hailou AI</Button>
            </div> */}
          </div>

          <div className="flex items-center space-x-4">
            {/* User Menu */}
            <div className="relative">
              <CSheet
                trigger={
                  <button className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100 group transition-colors">
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                      <User className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-700 hidden sm:block">
                      {user?.username || "Guest"}
                    </span>
                  </button>
                }
                title="Thông tin cá nhân"
                content={<UserProfileSheet user={user} />}
                footer={
                  <SheetClose asChild>
                    {/* Footer với nút đăng xuất */}
                    <Button
                      onClick={handleLogout}
                      variant="outline"
                      className="w-full flex items-center justify-center space-x-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Đăng xuất</span>
                    </Button>
                  </SheetClose>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
