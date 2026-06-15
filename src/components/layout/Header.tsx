"use client";

import { useHeaderControl } from "@/hooks/header/useHeaderControl";
import { LogOut, User, Bell } from "lucide-react";
import UserProfileSheet from "../sections/user-profile/UserProfileSheet";
import { CSheet } from "../shared/CSheet";
import { Button } from "../ui/button";
import { SheetClose } from "../ui/Sheet";
import packageJson from "../../../package.json";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { INotification, getNotificationsService } from "@/service/api/notificationService";

export default function Header() {
  const { user, handleLogout } = useHeaderControl();
  const [notifications, setNotifications] = useState<INotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    const fetchNotifs = async () => {
      try {
        const data = await getNotificationsService(true);
        const notifs = data || [];
        setNotifications(notifs);

        // Calculate unread count
        let readNotifs: Record<number, string> = {};
        try {
          const stored = JSON.parse(localStorage.getItem('readNotifications') || '{}');
          if (Array.isArray(stored)) {
            readNotifs = {};
          } else {
            readNotifs = stored;
          }
        } catch (e) {
          readNotifs = {};
        }

        const unread = notifs.filter((n: any) => readNotifs[n.id] !== String(n.updatedAt));
        setUnreadCount(unread.length);
      } catch (e) {
        console.error("Failed to fetch notifications");
      }
    };
    fetchNotifs();
  }, [pathname]);

  const handleOpenChange = (open: boolean) => {
    if (open && notifications.length > 0) {
      const readNotifs: Record<number, string> = {};
      notifications.forEach(n => {
        readNotifs[n.id] = String(n.updatedAt);
      });
      localStorage.setItem('readNotifications', JSON.stringify(readNotifs));
      setUnreadCount(0);
    }
  };

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
          </div>

          <div className="flex items-center space-x-4">
            {/* Version Changelog Button */}
            {notifications.length > 0 && (
              <Dialog onOpenChange={handleOpenChange}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="hidden sm:flex relative items-center space-x-2 border-emerald-200 hover:bg-emerald-50 text-emerald-700">
                    <Bell className="w-4 h-4" />
                    <span>Những thay đổi ở phiên bản {packageJson.version}</span>
                    {unreadCount > 0 && (
                      <span className="absolute -top-2 -right-2 flex items-center justify-center min-w-5 h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full border-[1.5px] border-white shadow-sm animate-pulse">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                 
                  <div className="mt-2 space-y-6">
                    {notifications.map((notif) => (
                      <div key={notif.id} className="border-b pb-4 last:border-0 last:pb-0">
                        <h3 className="font-bold text-2xl text-gray-900 mb-4 text-center">{notif.title}</h3>
                        <div className="text-base text-gray-700 whitespace-pre-wrap leading-relaxed">
                          {notif.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            )}

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
