"use client";

import React, { useEffect, useState } from "react";
import { Users, MonitorPlay, Save, CheckCircle2, AlertCircle } from "lucide-react";
import { Notify } from "@/lib/Notify";

interface UserConfig {
  id: string | number;
  username: string;
  computerId: string;
  role: string;
  isHeadless: boolean;
}

const AdminUsersPage = () => {
  const [users, setUsers] = useState<UserConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setUsers(data);
    } catch (e) {
      console.error(e);
      Notify({ title: "Lỗi", description: "Không thể lấy danh sách người dùng", status: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleToggleHeadless = async (userId: string | number, currentVal: boolean) => {
    try {
      const newVal = !currentVal;
      // Optimistic update
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isHeadless: newVal } : u)));

      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, isHeadless: newVal }),
      });

      if (!res.ok) throw new Error("Failed to update");
      Notify({ title: "Thành công", description: `Đã cập nhật trạng thái chạy ngầm cho User ${userId}`, status: "success" });
    } catch (e) {
      console.error(e);
      Notify({ title: "Lỗi", description: "Không thể cập nhật cấu hình", status: "error" });
      // Revert on error
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, isHeadless: currentVal } : u)));
    }
  };

  return (
    <div className="space-y-8 mt-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-stone-800 flex items-center gap-3">
              <Users className="w-8 h-8 text-emerald-500" />
              Quản lý Người dùng (Automation)
            </h1>
            <p className="text-stone-500 mt-2">
              Bật/Tắt chế độ chạy ngầm (Headless) cho từng máy trạm.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-stone-500">Đang tải dữ liệu...</div>
          ) : users.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-stone-500">
              <AlertCircle className="w-12 h-12 mb-4 text-stone-300" />
              <p>Chưa có người dùng nào sử dụng hệ thống Automation.</p>
              <p className="text-sm mt-1">Khi user bắt đầu tiến trình, họ sẽ tự động xuất hiện ở đây.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-stone-600">
                <thead className="bg-stone-50 border-b border-stone-200 text-stone-800 uppercase font-semibold">
                  <tr>
                    <th className="px-6 py-4">ID</th>
                    <th className="px-6 py-4">Username</th>
                    <th className="px-6 py-4">Computer ID</th>
                    <th className="px-6 py-4">Vai trò</th>
                    <th className="px-6 py-4 text-center">Chạy ngầm (Headless)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-stone-50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs">{user.id}</td>
                      <td className="px-6 py-4 font-medium">{user.username}</td>
                      <td className="px-6 py-4">{user.computerId}</td>
                      <td className="px-6 py-4">
                        <span className="px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full text-xs font-semibold uppercase">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex justify-center items-center">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={user.isHeadless}
                              onChange={() => handleToggleHeadless(user.id, user.isHeadless)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                          </label>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminUsersPage;
