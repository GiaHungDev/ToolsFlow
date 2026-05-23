"use client";

import CustomTable from "@/components/shared/CTable";
import { TableColumn } from "@/components/shared/CTable/interface";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppSelector } from "@/lib/redux/store";
import { Notify } from "@/lib/Notify";
import {
  getFlowAccounts,
  createFlowAccount,
  updateFlowAccount,
  deleteFlowAccount,
  getBasAccounts,
  createBasAccount,
  updateBasAccount,
  deleteBasAccount,
  getAutomationUsers,
  createAutomationUser,
  updateAutomationUser,
  deleteAutomationUser,
  IFlowAccount,
  IBasAccount,
  IAccountWeb,
} from "@/service/api/adminService";
import {
  Shield,
  Plus,
  Edit,
  Trash2,
  ArrowLeft,
  Lock,
  Mail,
  Key,
  Users,
  User,
  Database,
  Search,
  X,
  Loader2,
  ExternalLink,
  MonitorPlay,
} from "lucide-react";

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAppSelector((state) => state.auth);

  // tab state: 'flow' or 'bas' or 'users'
  const [activeTab, setActiveTab] = useState<"flow" | "bas" | "users">("flow");

  // data states
  const [flowAccounts, setFlowAccounts] = useState<IFlowAccount[]>([]);
  const [basAccounts, setBasAccounts] = useState<IBasAccount[]>([]);
  const [automationUsers, setAutomationUsers] = useState<IAccountWeb[]>([]);
  const [loading, setLoading] = useState(true);

  // search/filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<any[]>([]);

  // flow account modal state
  const [isFlowModalOpen, setIsFlowModalOpen] = useState(false);
  const [editingFlow, setEditingFlow] = useState<IFlowAccount | null>(null);
  const [flowEmail, setFlowEmail] = useState("");
  const [flowPassword, setFlowPassword] = useState("");
  const [flowTwoFa, setFlowTwoFa] = useState("");
  const [flowCookies, setFlowCookies] = useState("");

  // bas account modal state
  const [isBasModalOpen, setIsBasModalOpen] = useState(false);
  const [editingBas, setEditingBas] = useState<IBasAccount | null>(null);
  const [basUsername, setBasUsername] = useState("");
  const [basPassword, setBasPassword] = useState("");
  const [basStaffCount, setBasStaffCount] = useState<number | "">("");
  const [basFlowAccountId, setBasFlowAccountId] = useState<number | "">("");

  // user modal state
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formUserId, setFormUserId] = useState("");
  const [userUsername, setUserUsername] = useState("");
  const [userComputerId, setUserComputerId] = useState("");
  const [userRole, setUserRole] = useState("user");

  // delete confirmation state
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<"flow" | "bas" | "users" | null>(null);
  const [deleteId, setDeleteId] = useState<any>(null);

  // Load all data
  const loadData = async () => {
    try {
      setLoading(true);
      const [flows, bases, usersResp] = await Promise.all([
        getFlowAccounts(),
        getBasAccounts(),
        getAutomationUsers(),
      ]);
      setFlowAccounts(flows || []);
      setBasAccounts(bases || []);
      setAutomationUsers(usersResp || []);
    } catch (error: any) {
      console.error("Error loading admin data:", error);
      Notify({
        title: "Lỗi tải dữ liệu",
        description: error?.response?.data?.message || "Không thể kết nối tới server API.",
        status: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Nếu chưa có user (chưa tải xong state hoặc vừa đăng xuất) thì không làm gì cả
    if (!user) return;

    if (user.role !== "ADMIN") {
      Notify({
        title: "Từ chối truy cập",
        description: "Bạn không có quyền quản trị để truy cập trang này.",
        status: "warning",
      });
      router.push("/flow-ai");
      return;
    }
    loadData();
  }, [user, router]);

  // Clean form flow
  const resetFlowForm = (item: IFlowAccount | null = null) => {
    if (item) {
      setEditingFlow(item);
      setFlowEmail(item.email || "");
      setFlowPassword(item.password || "");
      setFlowTwoFa(item.twoFaCode || "");
      setFlowCookies(item.cookies ? JSON.stringify(item.cookies, null, 2) : "");
    } else {
      setEditingFlow(null);
      setFlowEmail("");
      setFlowPassword("");
      setFlowTwoFa("");
      setFlowCookies("");
    }
  };

  // Clean form bas
  const resetBasForm = (item: IBasAccount | null = null) => {
    if (item) {
      setEditingBas(item);
      setBasUsername(item.username || "");
      setBasPassword(item.password || "");
      setBasStaffCount(item.staffCount !== undefined && item.staffCount !== null ? item.staffCount : "");
      setBasFlowAccountId(item.flowAccountId !== undefined && item.flowAccountId !== null ? item.flowAccountId : "");
    } else {
      setEditingBas(null);
      setBasUsername("");
      setBasPassword("");
      setBasStaffCount("");
      setBasFlowAccountId("");
    }
  };

  // Clean form user
  const resetUserForm = (item: any = null) => {
    if (item) {
      setEditingUser(item);
      setFormUserId(String(item.id || ""));
      setUserUsername(item.username || "");
      setUserComputerId(item.computerId || "");
      setUserRole(item.role || "user");
    } else {
      setEditingUser(null);
      setFormUserId("");
      setUserUsername("");
      setUserComputerId("");
      setUserRole("user");
    }
  };

  // Toggle Headless for Automation Users
  const handleToggleHeadless = async (userId: string | number, currentVal: boolean) => {
    try {
      await updateAutomationUser(Number(userId), { isHeadless: !currentVal });
      setAutomationUsers(prev => 
        prev.map(u => u.id === userId ? { ...u, isHeadless: !currentVal } : u)
      );
      Notify({ title: "Cập nhật thành công", description: `Đã ${!currentVal ? "Bật" : "Tắt"} chạy ngầm.`, status: "success" });
    } catch (err) {
      Notify({ title: "Lỗi", description: "Không thể cập nhật trạng thái", status: "error" });
    }
  };

  // Toggle role handler
  const handleToggleRole = async (userId: string | number, currentRole: string) => {
    if (user?.username !== 'admin') {
       Notify({ title: "Từ chối", description: "Chỉ Admin cấp cao mới được đổi quyền.", status: "warning" });
       return;
    }

    const targetUser = automationUsers.find(u => u.id === userId);
    if (targetUser?.username === 'admin') {
       Notify({ title: "Từ chối", description: "Không thể thay đổi quyền của tài khoản Admin gốc.", status: "warning" });
       return;
    }

    const newRole = currentRole === 'ADMIN' ? 'USER' : 'ADMIN';
    try {
      await updateAutomationUser(Number(userId), { role: newRole });
      setAutomationUsers(prev => 
        prev.map(u => u.id === userId ? { ...u, role: newRole } : u)
      );
      Notify({ title: "Thành công", description: `Đã đổi quyền thành ${newRole}.`, status: "success" });
    } catch (err) {
      Notify({ title: "Lỗi", description: "Không thể đổi quyền.", status: "error" });
    }
  };

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedKeys.length === 0) return;
    if (!window.confirm(`Bạn có chắc chắn muốn xóa ${selectedKeys.length} mục đã chọn?`)) return;

    try {
      setLoading(true);
      if (activeTab === "flow") {
        await Promise.all(selectedKeys.map(id => deleteFlowAccount(Number(id))));
      } else if (activeTab === "bas") {
        await Promise.all(selectedKeys.map(id => deleteBasAccount(Number(id))));
      } else if (activeTab === "users") {
        const hasAdmin = selectedKeys.some(id => {
           const u = automationUsers.find(user => user.id === id);
           return u?.username === 'admin';
        });
        if (hasAdmin) {
           Notify({ title: "Từ chối", description: "Không thể xóa tài khoản Admin gốc trong danh sách chọn.", status: "warning" });
           setLoading(false);
           return;
        }
        await Promise.all(selectedKeys.map(id => deleteAutomationUser(Number(id))));
      }
      Notify({ title: "Thành công", description: `Đã xóa ${selectedKeys.length} mục.`, status: "success" });
      setSelectedKeys([]);
      loadData();
    } catch (err) {
      Notify({ title: "Lỗi xóa hàng loạt", description: "Có lỗi xảy ra khi xóa các mục đã chọn.", status: "error" });
      setLoading(false);
    }
  };

  // Save Flow Account
  const handleSaveFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowEmail.trim()) {
      Notify({ title: "Lỗi biểu mẫu", description: "Email không được để trống", status: "warning" });
      return;
    }

    let parsedCookies = null;
    if (flowCookies.trim()) {
      try {
        parsedCookies = JSON.parse(flowCookies);
      } catch {
        Notify({
          title: "Lỗi cấu hình Cookies",
          description: "Cookies phải ở định dạng JSON hợp lệ.",
          status: "error",
        });
        return;
      }
    }

    try {
      const data: Partial<IFlowAccount> = {
        email: flowEmail.trim(),
        password: flowPassword,
        twoFaCode: flowTwoFa,
        cookies: parsedCookies,
      };

      if (editingFlow) {
        await updateFlowAccount(editingFlow.id, data);
        Notify({ title: "Thành công", description: "Cập nhật tài khoản Flow thành công!", status: "success" });
      } else {
        await createFlowAccount(data);
        Notify({ title: "Thành công", description: "Tạo tài khoản Flow thành công!", status: "success" });
      }
      setIsFlowModalOpen(false);
      loadData();
    } catch (error: any) {
      Notify({
        title: "Lỗi xử lý",
        description: error?.response?.data?.message || "Đã xảy ra lỗi khi lưu thông tin tài khoản Flow.",
        status: "error",
      });
    }
  };

  // Save BAS Account
  const handleSaveBas = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!basUsername.trim() || !basPassword.trim()) {
      Notify({ title: "Lỗi biểu mẫu", description: "Tên đăng nhập và mật khẩu không được để trống", status: "warning" });
      return;
    }

    try {
      const data: Partial<IBasAccount> = {
        username: basUsername.trim(),
        password: basPassword.trim(),
        staffCount: basStaffCount !== "" ? Number(basStaffCount) : null as any,
        flowAccountId: basFlowAccountId !== "" ? Number(basFlowAccountId) : null,
      };

      if (editingBas) {
        await updateBasAccount(editingBas.id, data);
        Notify({ title: "Thành công", description: "Cập nhật tài khoản BAS thành công!", status: "success" });
      } else {
        await createBasAccount(data);
        Notify({ title: "Thành công", description: "Tạo tài khoản BAS thành công!", status: "success" });
      }
      setIsBasModalOpen(false);
      loadData();
    } catch (error: any) {
      Notify({
        title: "Lỗi xử lý",
        description: error?.response?.data?.message || "Đã xảy ra lỗi khi lưu thông tin tài khoản BAS.",
        status: "error",
      });
    }
  };

  // Save Automation User
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userUsername.trim()) {
      Notify({ title: "Lỗi biểu mẫu", description: "Tên người dùng không được để trống", status: "warning" });
      return;
    }

    try {
      if (editingUser) {
        await updateAutomationUser(editingUser.id, {
          username: userUsername.trim(),
          computerId: userComputerId.trim(),
          role: userRole
        });
        Notify({ title: "Thành công", description: "Cập nhật thông tin người dùng thành công!", status: "success" });
      } else {
        await createAutomationUser({
          username: userUsername.trim(),
          computerId: userComputerId.trim(),
          role: userRole,
          isHeadless: true
        });
        Notify({ title: "Thành công", description: "Thêm người dùng mới thành công!", status: "success" });
      }
      setIsUserModalOpen(false);
      loadData();
    } catch (error: any) {
      Notify({
        title: "Lỗi xử lý",
        description: "Đã xảy ra lỗi khi lưu thông tin người dùng.",
        status: "error",
      });
    }
  };

  // Trigger delete flow
  const triggerDeleteFlow = (id: number) => {
    setDeleteType("flow");
    setDeleteId(id);
    setIsDeleteOpen(true);
  };

  // Trigger delete bas
  const triggerDeleteBas = (id: number) => {
    setDeleteType("bas");
    setDeleteId(id);
    setIsDeleteOpen(true);
  };

  // Trigger delete user
  const triggerDeleteUser = (id: string | number) => {
    const targetUser = automationUsers.find(u => u.id === id);
    if (targetUser?.username === 'admin') {
       Notify({ title: "Từ chối", description: "Không thể xóa tài khoản Admin gốc.", status: "warning" });
       return;
    }
    setDeleteType("users");
    setDeleteId(id);
    setIsDeleteOpen(true);
  };

  // Confirm delete action
  const handleConfirmDelete = async () => {
    if (!deleteType || !deleteId) return;

    try {
      if (deleteType === "flow") {
        await deleteFlowAccount(deleteId);
        Notify({ title: "Xóa thành công", description: "Đã xóa tài khoản Flow khỏi hệ thống.", status: "success" });
      } else if (deleteType === "bas") {
        await deleteBasAccount(deleteId);
        Notify({ title: "Xóa thành công", description: "Đã xóa tài khoản BAS khỏi hệ thống.", status: "success" });
      } else if (deleteType === "users") {
        await deleteAutomationUser(Number(deleteId));
        Notify({ title: "Xóa thành công", description: "Đã xóa người dùng khỏi hệ thống.", status: "success" });
      }
      setIsDeleteOpen(false);
      loadData();
    } catch (error: any) {
      Notify({
        title: "Lỗi xóa tài khoản",
        description: error?.response?.data?.message || "Không thể thực hiện yêu cầu xóa.",
        status: "error",
      });
    }
  };

  // Filtered lists (useMemo to prevent CTable from resetting selection on every render)
  const filteredFlows = React.useMemo(() => flowAccounts.filter((acc) =>
    acc.email.toLowerCase().includes(searchTerm.toLowerCase())
  ), [flowAccounts, searchTerm]);

  const filteredBases = React.useMemo(() => basAccounts.filter((acc) =>
    acc.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    acc.flowAccount?.email.toLowerCase().includes(searchTerm.toLowerCase())
  ), [basAccounts, searchTerm]);

  const filteredUsers = React.useMemo(() => automationUsers.filter((u) =>
    u.username.toLowerCase().includes(searchTerm.toLowerCase())
  ), [automationUsers, searchTerm]);

  if (!user || user.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center min-screen h-[70vh] text-center px-4">
        <Loader2 className="h-10 w-10 text-emerald-600 animate-spin mb-4" />
        <p className="text-gray-500 font-medium">Đang kiểm tra quyền quản trị của bạn...</p>
      </div>
    );
  }

  // Table Columns
  const flowColumns: TableColumn<IFlowAccount>[] = [
    { key: "email", title: "Email liên hệ" },
    { key: "password", title: "Mật khẩu", render: (_, row) => row.password ? "••••••••" : <span className="italic text-gray-300">Không có</span> },
    { key: "twoFaCode", title: "Mã 2FA (Auth Code)", render: (_, row) => row.twoFaCode || <span className="italic text-gray-300">Không có</span> },
    { key: "cookies", title: "Trạng thái Cookies", render: (_, row) => row.cookies ? (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
        Có JSON Cookies
      </span>
    ) : (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
        Không có
      </span>
    ) },
    { key: "actions", title: "Hành động", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            resetFlowForm(row);
            setIsFlowModalOpen(true);
          }}
          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
          title="Sửa thông tin"
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={() => triggerDeleteFlow(row.id)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa tài khoản"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) }
  ];

  const userColumns: TableColumn<any>[] = [
    { key: "id", title: "ID User" },
    { key: "username", title: "Tên người dùng (Username)" },
    { key: "computerId", title: "Thiết bị & IP (Anti-Sharing)", render: (_, row) => {
      const hasDevices = row.knownDevices && Object.keys(row.knownDevices).length > 0;
      return (
        <div>
          {!hasDevices && (
            <div className="font-medium text-gray-700">
              {row.computerId || <span className="italic text-gray-400">Không có</span>}
            </div>
          )}
          
          {hasDevices && (
            <div className="flex flex-col gap-2">
              {Object.entries(row.knownDevices).map(([deviceId, info]: any) => (
                  <div key={deviceId} className="flex flex-col text-sm">
                      <span className="text-gray-700 font-medium">PC: {deviceId}</span>
                      <span className="text-emerald-600 mt-0.5">IP: {info.ip === '::1' ? '127.0.0.1 (Local)' : info.ip}</span>
                  </div>
              ))}
            </div>
          )}
        </div>
      );
    } },
    { key: "isHeadless", title: "Chạy ngầm (Headless)", render: (_, row) => (
      <div className="text-center">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={row.isHeadless}
            onChange={() => handleToggleHeadless(row.id, row.isHeadless)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
        </label>
      </div>
    ) },
    { key: "role", title: "Vai trò", render: (_, row) => {
      const isSuperAdmin = user?.username === 'admin';
      const isCurrentAdmin = row.role === 'ADMIN';
      const isRowSuperAdmin = row.username === 'admin';
      
      return (
        <div className="flex bg-gray-100/80 rounded-lg p-1 w-fit border border-gray-200">
          <button 
            disabled={!isSuperAdmin || isRowSuperAdmin}
            onClick={() => handleToggleRole(row.id, row.role)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
              !isCurrentAdmin ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50' : 'text-gray-500 hover:text-gray-700'
            } ${(!isSuperAdmin || isRowSuperAdmin) ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            USER
          </button>
          <button 
            disabled={!isSuperAdmin || isRowSuperAdmin}
            onClick={() => handleToggleRole(row.id, row.role)}
            className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${
              isCurrentAdmin ? 'bg-white text-red-600 shadow-sm border border-red-100' : 'text-gray-500 hover:text-gray-700'
            } ${(!isSuperAdmin || isRowSuperAdmin) ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            ADMIN
          </button>
        </div>
      );
    }},
    { key: "actions", title: "Hành động", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            resetUserForm(row);
            setIsUserModalOpen(true);
          }}
          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
          title="Sửa"
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={() => triggerDeleteUser(row.id)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) }
  ];

  const basColumns: TableColumn<IBasAccount>[] = [
    { key: "username", title: "Tên đăng nhập BAS" },
    { key: "password", title: "Mật khẩu", render: (_, row) => row.password ? "••••••••" : <span className="italic text-gray-300">Không có</span> },
    { key: "staffCount", title: "Số lượng luồng (Staff)", render: (_, row) => (
      <span className="font-semibold">{row.staffCount !== null && row.staffCount !== undefined ? row.staffCount : <span className="italic font-normal text-gray-300">Không giới hạn</span>}</span>
    ) },
    { key: "flowAccount", title: "Tài khoản Flow liên kết", render: (_, row) => row.flowAccount ? (
      <div className="flex flex-col">
        <span className="text-sm font-medium text-emerald-600 flex items-center gap-1">
          {row.flowAccount.email}
          <ExternalLink className="h-3 w-3" />
        </span>
        {row.flowAccount.twoFaCode && (
          <span className="text-xs text-gray-400">2FA: {row.flowAccount.twoFaCode}</span>
        )}
      </div>
    ) : (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">
        Chưa liên kết
      </span>
    ) },
    { key: "actions", title: "Hành động", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            resetBasForm(row);
            setIsBasModalOpen(true);
          }}
          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
          title="Sửa cấu hình"
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={() => triggerDeleteBas(row.id)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa cấu hình"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) }
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-16 text-gray-900">
      {/* Top bar & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 pb-6 border-b border-gray-100">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-gradient-to-tr from-emerald-600 to-emerald-600 rounded-xl shadow-lg">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Hệ thống Quản trị Harumi AI
            </h1>
          </div>
          <p className="text-gray-500 text-sm pl-1">
            Quản lý tài khoản dịch vụ Flow-Google Labs và tài khoản BAS liên kết.
          </p>
        </div>

        <button
          onClick={() => router.push("/flow-ai")}
          className="mt-4 sm:mt-0 inline-flex items-center space-x-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 transition shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Quay lại Dashboard</span>
        </button>
      </div>

      {/* Tabs list & search filter */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div className="flex p-1 bg-gray-100 rounded-xl space-x-1 w-full md:w-auto">
          <button
            onClick={() => {
              setActiveTab("flow");
              setSearchTerm("");
              setSelectedKeys([]);
            }}
            className={`flex items-center space-x-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === "flow"
                ? "bg-white text-emerald-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Database className="h-4 w-4" />
            <span>Tài khoản Flow ({flowAccounts.length})</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("bas");
              setSearchTerm("");
              setSelectedKeys([]);
            }}
            className={`flex items-center space-x-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === "bas"
                ? "bg-white text-emerald-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Users className="h-4 w-4" />
            <span>Tài khoản BAS ({basAccounts.length})</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("users");
              setSearchTerm("");
              setSelectedKeys([]);
            }}
            className={`flex items-center space-x-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === "users"
                ? "bg-white text-emerald-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <MonitorPlay className="h-4 w-4" />
            <span>Người dùng ({automationUsers.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              placeholder={activeTab === "flow" ? "Tìm email tài khoản Flow..." : activeTab === "bas" ? "Tìm tên hoặc email liên kết..." : "Tìm username người dùng..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2.5 w-full bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
            />
          </div>

          <div className="flex items-center gap-2">
            {selectedKeys.length > 0 && (
              <button
                onClick={handleBulkDelete}
                className="inline-flex items-center space-x-2 px-4 py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-semibold hover:bg-red-100 transition shadow-sm"
              >
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Xóa {selectedKeys.length}</span>
              </button>
            )}

            <button
              onClick={() => {
                if (activeTab === "flow") {
                  resetFlowForm();
                  setIsFlowModalOpen(true);
                } else if (activeTab === "bas") {
                  resetBasForm();
                  setIsBasModalOpen(true);
                } else {
                  resetUserForm();
                  setIsUserModalOpen(true);
                }
              }}
              className="inline-flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-600 text-white rounded-xl text-sm font-semibold hover:from-emerald-700 hover:to-emerald-700 shadow-md transition"
            >
              <Plus className="h-4 w-4" />
              <span>{activeTab === "flow" ? "Thêm tài khoản Flow" : activeTab === "bas" ? "Thêm tài khoản BAS" : "Thêm Người dùng"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main content table */}
      <div className="mb-8">
        <CustomTable<any>
          data={
            activeTab === "flow" ? filteredFlows :
            activeTab === "users" ? filteredUsers :
            filteredBases
          }
          columns={
            (activeTab === "flow" ? flowColumns :
            activeTab === "users" ? userColumns :
            basColumns) as any
          }
          loading={loading}
          enableSelection={true}
          onSelectionChange={(keys) => setSelectedKeys(keys)}
          enablePagination={false}
        />
      </div>

      {/* FLOW ACCOUNT MODAL */}
      {isFlowModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-gray-100 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingFlow ? "Sửa tài khoản Flow" : "Thêm mới tài khoản Flow"}
              </h2>
              <button
                onClick={() => setIsFlowModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveFlow}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email tài khoản</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                      <Mail className="h-4 w-4" />
                    </span>
                    <input
                      type="email"
                      value={flowEmail}
                      onChange={(e) => setFlowEmail(e.target.value)}
                      placeholder="vd: account@google.com"
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu (Tùy chọn)</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                      <Lock className="h-4 w-4" />
                    </span>
                    <input
                      type="text"
                      value={flowPassword}
                      onChange={(e) => setFlowPassword(e.target.value)}
                      placeholder="Mật khẩu của tài khoản..."
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mã cấu hình 2FA (Tùy chọn)</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                      <Key className="h-4 w-4" />
                    </span>
                    <input
                      type="text"
                      value={flowTwoFa}
                      onChange={(e) => setFlowTwoFa(e.target.value)}
                      placeholder="Nhập Secret Key 2FA để tự động gen OTP..."
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Cấu hình Cookies (Định dạng JSON - Tùy chọn)
                  </label>
                  <p className="text-xs text-gray-400 mb-1.5">
                    Dán mảng JSON Cookies đăng nhập Google Labs để tự động đăng nhập.
                  </p>
                  <textarea
                    value={flowCookies}
                    onChange={(e) => setFlowCookies(e.target.value)}
                    placeholder='{ "url": "https://labs.google", "cookies": [...] }'
                    rows={6}
                    className="p-3 w-full border border-gray-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-gray-50/50"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsFlowModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-100 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 shadow transition"
                >
                  Lưu cấu hình
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* BAS ACCOUNT MODAL */}
      {isBasModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-gray-100 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingBas ? "Sửa cấu hình BAS" : "Thêm mới cấu hình BAS"}
              </h2>
              <button
                onClick={() => setIsBasModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBas}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên đăng nhập BAS</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                      <User className="h-4 w-4" />
                    </span>
                    <input
                      type="text"
                      value={basUsername}
                      onChange={(e) => setBasUsername(e.target.value)}
                      placeholder="Username dùng đăng nhập Client BAS..."
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mật khẩu</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                      <Lock className="h-4 w-4" />
                    </span>
                    <input
                      type="password"
                      value={basPassword}
                      onChange={(e) => setBasPassword(e.target.value)}
                      placeholder="Mật khẩu của tài khoản..."
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Số lượng luồng tối đa (Tùy chọn)</label>
                  <input
                    type="number"
                    value={basStaffCount}
                    onChange={(e) => setBasStaffCount(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="Không nhập hoặc để trống = Không giới hạn luồng"
                    min={0}
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Liên kết tài khoản Flow</label>
                  <select
                    value={basFlowAccountId}
                    onChange={(e) => setBasFlowAccountId(e.target.value === "" ? "" : Number(e.target.value))}
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="">-- Chưa liên kết tài khoản nào --</option>
                    {flowAccounts.map((flow) => (
                      <option key={flow.id} value={flow.id}>
                        {flow.email}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsBasModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-100 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 shadow transition"
                >
                  Lưu cấu hình
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* USER ACCOUNT MODAL */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-gray-100 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingUser ? "Sửa người dùng Automation" : "Thêm người dùng Automation"}
              </h2>
              <button
                onClick={() => setIsUserModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên người dùng (Username)</label>
                  <input
                    type="text"
                    value={userUsername}
                    onChange={(e) => setUserUsername(e.target.value)}
                    placeholder="Nhập username..."
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Thiết bị (Computer ID)</label>
                  <input
                    type="text"
                    value={userComputerId}
                    onChange={(e) => setUserComputerId(e.target.value)}
                    placeholder="Nhập Computer ID..."
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Vai trò (Role)</label>
                  <select
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value)}
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-white"
                  >
                    <option value="user">User thường</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-100 transition"
                >
                  Hủy bỏ
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 shadow transition"
                >
                  Lưu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {isDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden border border-gray-100 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 text-center">
              <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-100">
                <Trash2 className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">
                Xác nhận xóa tài khoản?
              </h3>
              <p className="text-sm text-gray-500 leading-relaxed">
                Hành động này sẽ xóa vĩnh viễn cấu hình này khỏi hệ thống cơ sở dữ liệu và không thể hoàn tác. Bạn chắc chắn muốn tiếp tục?
              </p>
            </div>

            <div className="flex items-center justify-center gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
              <button
                onClick={() => setIsDeleteOpen(false)}
                className="px-4 py-2 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-100 transition"
              >
                Hủy bỏ
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-5 py-2 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 shadow transition"
              >
                Xác nhận xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
