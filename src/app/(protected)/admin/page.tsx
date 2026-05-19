"use client";

import { useEffect, useState } from "react";
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
  IFlowAccount,
  IBasAccount,
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
} from "lucide-react";

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAppSelector((state) => state.auth);

  // tab state: 'flow' or 'bas'
  const [activeTab, setActiveTab] = useState<"flow" | "bas">("flow");

  // data states
  const [flowAccounts, setFlowAccounts] = useState<IFlowAccount[]>([]);
  const [basAccounts, setBasAccounts] = useState<IBasAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // search/filter state
  const [searchTerm, setSearchTerm] = useState("");

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

  // delete confirmation state
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<"flow" | "bas" | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Load all data
  const loadData = async () => {
    try {
      setLoading(true);
      const [flows, bases] = await Promise.all([
        getFlowAccounts(),
        getBasAccounts(),
      ]);
      setFlowAccounts(flows || []);
      setBasAccounts(bases || []);
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
    if (user && user.role !== "ADMIN") {
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

  // Confirm delete action
  const handleConfirmDelete = async () => {
    if (!deleteType || !deleteId) return;

    try {
      if (deleteType === "flow") {
        await deleteFlowAccount(deleteId);
        Notify({ title: "Xóa thành công", description: "Đã xóa tài khoản Flow khỏi hệ thống.", status: "success" });
      } else {
        await deleteBasAccount(deleteId);
        Notify({ title: "Xóa thành công", description: "Đã xóa tài khoản BAS khỏi hệ thống.", status: "success" });
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

  if (!user || user.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center min-screen h-[70vh] text-center px-4">
        <Loader2 className="h-10 w-10 text-blue-600 animate-spin mb-4" />
        <p className="text-gray-500 font-medium">Đang kiểm tra quyền quản trị của bạn...</p>
      </div>
    );
  }

  // Filtered lists
  const filteredFlows = flowAccounts.filter((acc) =>
    acc.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredBases = basAccounts.filter((acc) =>
    acc.username.toLowerCase().includes(searchTerm.toLowerCase()) ||
    acc.flowAccount?.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-16 text-gray-900">
      {/* Top bar & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 pb-6 border-b border-gray-100">
        <div>
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl shadow-lg">
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
            }}
            className={`flex items-center space-x-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === "flow"
                ? "bg-white text-blue-600 shadow"
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
            }}
            className={`flex items-center space-x-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === "bas"
                ? "bg-white text-blue-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Users className="h-4 w-4" />
            <span>Tài khoản BAS ({basAccounts.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
              <Search className="h-4 w-4" />
            </span>
            <input
              type="text"
              placeholder={activeTab === "flow" ? "Tìm email tài khoản Flow..." : "Tìm tên hoặc email liên kết..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-4 py-2.5 w-full bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
            />
          </div>

          <button
            onClick={() => {
              if (activeTab === "flow") {
                resetFlowForm();
                setIsFlowModalOpen(true);
              } else {
                resetBasForm();
                setIsBasModalOpen(true);
              }
            }}
            className="inline-flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:from-blue-700 hover:to-indigo-700 shadow-md transition"
          >
            <Plus className="h-4 w-4" />
            <span>{activeTab === "flow" ? "Thêm tài khoản Flow" : "Thêm tài khoản BAS"}</span>
          </button>
        </div>
      </div>

      {/* Main content table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-3" />
            <p className="text-gray-400 text-sm">Đang tải danh sách tài khoản dịch vụ...</p>
          </div>
        ) : activeTab === "flow" ? (
          /* FLOW ACCOUNT TABLE */
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50/70">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Email liên hệ</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Mật khẩu</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Mã 2FA (Auth Code)</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Trạng thái Cookies</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredFlows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm">
                      Không tìm thấy tài khoản Flow nào phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredFlows.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {item.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {item.password ? "••••••••" : <span className="italic text-gray-300">Không có</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {item.twoFaCode || <span className="italic text-gray-300">Không có</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {item.cookies ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                            Có JSON Cookies
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
                            Không có
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => {
                              resetFlowForm(item);
                              setIsFlowModalOpen(true);
                            }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="Sửa thông tin"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => triggerDeleteFlow(item.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="Xóa tài khoản"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* BAS ACCOUNT TABLE */
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50/70">
                <tr>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tên đăng nhập BAS</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Mật khẩu</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Số lượng luồng (Staff)</th>
                  <th className="px-6 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Tài khoản Flow liên kết</th>
                  <th className="px-6 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {filteredBases.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm">
                      Không tìm thấy tài khoản BAS nào phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredBases.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50/50 transition">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {item.username}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-400">
                        {item.password ? "••••••••" : <span className="italic text-gray-300">Không có</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 font-semibold">
                        {item.staffCount !== null && item.staffCount !== undefined ? item.staffCount : <span className="italic font-normal text-gray-300">Không giới hạn</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {item.flowAccount ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-blue-600 flex items-center gap-1">
                              {item.flowAccount.email}
                              <ExternalLink className="h-3 w-3" />
                            </span>
                            {item.flowAccount.twoFaCode && (
                              <span className="text-xs text-gray-400">2FA: {item.flowAccount.twoFaCode}</span>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                            Chưa liên kết
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => {
                              resetBasForm(item);
                              setIsBasModalOpen(true);
                            }}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                            title="Sửa cấu hình"
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => triggerDeleteBas(item.id)}
                            className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="Xóa cấu hình"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
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
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
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
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
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
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
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
                    className="p-3 w-full border border-gray-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition bg-gray-50/50"
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
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 shadow transition"
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
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
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
                      className="pl-9 pr-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
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
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Liên kết tài khoản Flow</label>
                  <select
                    value={basFlowAccountId}
                    onChange={(e) => setBasFlowAccountId(e.target.value === "" ? "" : Number(e.target.value))}
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition bg-white"
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
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 shadow transition"
                >
                  Lưu cấu hình
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
