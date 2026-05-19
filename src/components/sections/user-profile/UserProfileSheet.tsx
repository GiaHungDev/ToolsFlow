"use client";

import { Badge, BadgeProps } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { IUser } from "@/types/user";
import dayjs from "dayjs";
import { Calendar, Mail, User, Shield } from "lucide-react";
import { useRouter } from "next/navigation";
import { SheetClose } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/button";

interface UserProfileProp {
  user: IUser | null;
}

const UserProfileSheet: React.FC<UserProfileProp> = ({ user }) => {
  const router = useRouter();

  if (!user) return null;

  return (
    <div className="w-full max-w-md mx-auto bg-white pt-20">
      {/* Header với avatar và tên */}
      <div className="flex flex-col items-center text-center pb-6 mb-6 border-b">
        <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center mb-3 shadow-lg">
          <User className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-1">
          {user.username}
        </h2>
      </div>

      {/* Thông tin chi tiết */}
      <div className="space-y-6">
        {/* Email */}
        {/* <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Mail className="h-5 w-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <Label className="text-sm font-medium text-gray-700">Email</Label>
            <p className="text-sm text-gray-900 break-words mt-1">
              {user.email}
            </p>
          </div>
        </div> */}

        {/* Ngày tạo tài khoản */}
        <div className="flex items-start space-x-3">
          <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0">
            <Calendar className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <Label className="text-sm font-medium text-gray-700">
              Ngày tạo tài khoản
            </Label>
            <p className="text-sm text-gray-900 mt-1">
              {dayjs(user.createdAt).format("DD/MM/YYYY")}
            </p>
          </div>
        </div>

        {/* Nút Admin - Chỉ hiện khi role là ADMIN */}
        {user.role === "ADMIN" && (
          <div className="pt-4 border-t border-gray-100">
            <SheetClose asChild>
              <Button
                onClick={() => router.push("/admin")}
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-medium shadow-md flex items-center justify-center space-x-2 transition-all duration-200"
              >
                <Shield className="h-4 w-4" />
                <span>Quản trị</span>
              </Button>
            </SheetClose>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserProfileSheet;
