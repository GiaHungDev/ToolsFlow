import { User } from "lucide-react";
import { CSheet } from "../shared/CSheet";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SheetClose } from "../ui/sheet";

export default function Header() {
  return (
    <header className="bg-white border-b border-gray-200 shadow-md">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left side - Logo and Navigation */}
          <div className="flex items-center space-x-4">
            {/* Logo */}
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">H</span>
              </div>
              <span className="text-xl font-semibold text-gray-900 hidden sm:block">
                HARUMI-AI
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* User Menu */}
            <div className="relative">
              <CSheet
                trigger={
                  <button className="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100 group">
                    <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full flex items-center justify-center">
                      <User className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-700 hidden sm:block">
                      John Doe
                    </span>
                  </button>
                }
                title="Thông tin cá nhân"
                content={
                  <div className="grid flex-1 auto-rows-min gap-6 px-4">
                    <div className="grid gap-3">
                      <Label htmlFor="sheet-demo-name">Name</Label>
                      <Input id="sheet-demo-name" defaultValue="Pedro Duarte" />
                    </div>
                    <div className="grid gap-3">
                      <Label htmlFor="sheet-demo-username">Username</Label>
                      <Input
                        id="sheet-demo-username"
                        defaultValue="@peduarte"
                      />
                    </div>
                  </div>
                }
                footer={
                  <>
                    <SheetClose asChild>
                      <Button variant="outline">Đóng</Button>
                    </SheetClose>
                  </>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
