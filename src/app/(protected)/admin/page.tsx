"use client";

import { DatePicker } from "react-rainbow-components";
import CustomTable from "@/components/shared/CTable";
import { TableColumn } from "@/components/shared/CTable/interface";
import { INotification, getNotificationsService, createNotificationService, updateNotificationService, deleteNotificationService } from "@/service/api/notificationService";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  getUserStats,
  getGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  assignUserToGroup,
  getAdminStats,
  exportAdminStats,
  IFlowAccount,
  IBasAccount,
  IAccountWeb,
  IUserGroup,
} from "@/service/api/adminService";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  BarChart2,
  FileSpreadsheet,
  RefreshCw,
  Bell,
  Trophy,
  Medal,
  Crown,
  Flame,
  Award,
  TrendingUp,
  CheckCircle,
  Clock,
  XCircle,
  Sparkles,
  Filter,
} from "lucide-react";

function getDatesFromWeekString(weekStr: string): { startDate: string; endDate: string } | null {
  if (!weekStr) return null;
  const match = weekStr.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);
  
  const jan1 = new Date(year, 0, 1);
  const day = jan1.getDay();
  const jan1Monday = new Date(year, 0, 1 + (day <= 4 ? 1 - day : 8 - day));
  
  const startDate = new Date(jan1Monday.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
  const endDate = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
  
  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
}

function getDatesFromMonthString(monthStr: string): { startDate: string; endDate: string } | null {
  if (!monthStr) return null;
  const match = monthStr.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  
  return {
    startDate: startDate.toISOString().split("T")[0],
    endDate: endDate.toISOString().split("T")[0],
  };
}

function getWeeksList(year: number) {
  const weeks = [];
  const jan1 = new Date(year, 0, 1);
  const day = jan1.getDay();
  const jan1Monday = new Date(year, 0, 1 + (day <= 4 ? 1 - day : 8 - day));
  
  for (let w = 1; w <= 53; w++) {
    const start = new Date(jan1Monday.getTime() + (w - 1) * 7 * 24 * 60 * 60 * 1000);
    if (start.getFullYear() > year) {
      break;
    }
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    
    const startStr = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`;
    const endStr = `${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}`;
    
    weeks.push({
      value: `${year}-W${String(w).padStart(2, '0')}`,
      label: `Tuần ${w} (${startStr} - ${endStr})`,
    });
  }
  return weeks.reverse();
}

function getMonthsList(year: number) {
  const months = [];
  for (let m = 12; m >= 1; m--) {
    months.push({
      value: `${year}-${String(m).padStart(2, '0')}`,
      label: `Tháng ${m}/${year}`,
    });
  }
  return months;
}

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAppSelector((state) => state.auth);

  const currentYear = new Date().getFullYear();
  const weeksList = React.useMemo(() => {
    return [
      ...getWeeksList(currentYear),
      ...getWeeksList(currentYear - 1)
    ];
  }, [currentYear]);

  const monthsList = React.useMemo(() => {
    return [
      ...getMonthsList(currentYear),
      ...getMonthsList(currentYear - 1)
    ];
  }, [currentYear]);

  // tab state: 'flow' or 'bas' or 'users' or 'groups' or 'stats' or 'notifications'
  const [activeTab, setActiveTab] = useState<"flow" | "bas" | "users" | "groups" | "stats" | "notifications">("flow");

  // data states
  const [flowAccounts, setFlowAccounts] = useState<IFlowAccount[]>([]);
  const [basAccounts, setBasAccounts] = useState<IBasAccount[]>([]);
  const [automationUsers, setAutomationUsers] = useState<IAccountWeb[]>([]);
  const [groups, setGroups] = useState<IUserGroup[]>([]);
  const [notifications, setNotifications] = useState<INotification[]>([]);
  const [loading, setLoading] = useState(true);

  // search/filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<any[]>([]);
  const [filterGroupId, setFilterGroupId] = useState<string>("");

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
  const [userGroupId, setUserGroupId] = useState<string | number>("");

  // group modal state
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<IUserGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");

  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [editingNotification, setEditingNotification] = useState<INotification | null>(null);
  const [notificationFormData, setNotificationFormData] = useState({ title: '', content: '', isActive: true });

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<"flow" | "bas" | "users" | "groups" | null>(null);
  const [deleteId, setDeleteId] = useState<any>(null);

  // stats modal state
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [statsUser, setStatsUser] = useState<any>(null);
  const [statsData, setStatsData] = useState<{ total: number; completed: number; failed: number; processing: number } | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);

  // Load all data
  const loadData = async () => {
    try {
      setLoading(true);
      const [flows, bases, accounts, groupsData, notifs] = await Promise.all([
        getFlowAccounts(),
        getBasAccounts(),
        getAutomationUsers(),
        getGroups(),
        getNotificationsService(false),
      ]);
      setFlowAccounts(flows || []);
      setBasAccounts(bases || []);
      setAutomationUsers(accounts || []);
      setGroups(groupsData || []);
      setNotifications(notifs || []);
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

  // Admin stats page state
  const [statsStartDate, setStatsStartDate] = useState("");
  const [statsEndDate, setStatsEndDate] = useState("");
  const [statsGroupId, setStatsGroupId] = useState<string | number>("");
  const [statsPeriod, setStatsPeriod] = useState<'day' | 'week' | 'month'>("day");
  const [adminStatsData, setAdminStatsData] = useState<any>(null);
  const [isAdminStatsLoading, setIsAdminStatsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Ranking and Stats Sub-tab State
  const [statsSubTab, setStatsSubTab] = useState<"ranking" | "groups" | "overview">("ranking");
  const [statsTopLimit, setStatsTopLimit] = useState<string | number>(10);
  const [rankingSearchTerm, setRankingSearchTerm] = useState("");
  const [timePreset, setTimePreset] = useState<"all" | "today" | "week" | "month" | "year" | "custom">("all");

  const handleTimePresetChange = (preset: "all" | "today" | "week" | "month" | "year" | "custom") => {
    setTimePreset(preset);
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];

    if (preset === "all") {
      setStatsStartDate("");
      setStatsEndDate("");
    } else if (preset === "today") {
      setStatsStartDate(todayStr);
      setStatsEndDate(todayStr);
    } else if (preset === "week") {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(now);
      monday.setDate(diff);
      setStatsStartDate(monday.toISOString().split("T")[0]);
      setStatsEndDate(todayStr);
    } else if (preset === "month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setStatsStartDate(firstDay.toISOString().split("T")[0]);
      setStatsEndDate(todayStr);
    } else if (preset === "year") {
      const firstDay = new Date(now.getFullYear(), 0, 1);
      setStatsStartDate(firstDay.toISOString().split("T")[0]);
      setStatsEndDate(todayStr);
    }
  };

  const fetchAdminStats = async () => {
    try {
      setIsAdminStatsLoading(true);
      
      let startDate = statsStartDate || undefined;
      let endDate = statsEndDate || undefined;
      
      if (statsPeriod === "week") {
        const boundsStart = getDatesFromWeekString(statsStartDate);
        const boundsEnd = getDatesFromWeekString(statsEndDate);
        startDate = boundsStart?.startDate || undefined;
        endDate = boundsEnd?.endDate || undefined;
      } else if (statsPeriod === "month") {
        const boundsStart = getDatesFromMonthString(statsStartDate);
        const boundsEnd = getDatesFromMonthString(statsEndDate);
        startDate = boundsStart?.startDate || undefined;
        endDate = boundsEnd?.endDate || undefined;
      }

      const res = await getAdminStats({
        startDate,
        endDate,
        groupId: statsGroupId ? Number(statsGroupId) : undefined,
      });
      setAdminStatsData(res);
    } catch (err) {
      console.error(err);
      Notify({ title: "Lỗi", description: "Không thể tải số liệu thống kê", status: "error" });
    } finally {
      setIsAdminStatsLoading(false);
    }
  };

  const handleExportExcel = async () => {
    try {
      setIsExporting(true);
      
      let startDate = statsStartDate || undefined;
      let endDate = statsEndDate || undefined;
      
      if (statsPeriod === "week") {
        const boundsStart = getDatesFromWeekString(statsStartDate);
        const boundsEnd = getDatesFromWeekString(statsEndDate);
        startDate = boundsStart?.startDate || undefined;
        endDate = boundsEnd?.endDate || undefined;
      } else if (statsPeriod === "month") {
        const boundsStart = getDatesFromMonthString(statsStartDate);
        const boundsEnd = getDatesFromMonthString(statsEndDate);
        startDate = boundsStart?.startDate || undefined;
        endDate = boundsEnd?.endDate || undefined;
      }

      const blob = await exportAdminStats({
        startDate,
        endDate,
        groupId: statsGroupId ? Number(statsGroupId) : undefined,
        period: statsPeriod,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const groupNameStr = statsGroupId 
        ? (groups.find(g => g.id === Number(statsGroupId))?.name || "Nhom") 
        : "Tat_ca_nhom";
      // Sanitize group name to be safe for filenames
      const safeGroupName = groupNameStr.replace(/[^a-zA-Z0-9_]/g, "_");

      let dateRangeStr = new Date().toISOString().split("T")[0].split("-").reverse().join("-"); // Default to DD-MM-YYYY
      if (startDate && endDate) {
        const d1 = startDate.split("-");
        const d2 = endDate.split("-");
        if (d1[0] === d2[0]) {
          // Same year: DD-MM_DD-MM-YYYY
          dateRangeStr = `${d1[2]}-${d1[1]}_${d2[2]}-${d2[1]}-${d2[0]}`;
        } else {
          // Different years: DD-MM-YYYY_DD-MM-YYYY
          dateRangeStr = `${d1[2]}-${d1[1]}-${d1[0]}_${d2[2]}-${d2[1]}-${d2[0]}`;
        }
      } else if (startDate) {
        dateRangeStr = startDate.split("-").reverse().join("-");
      }

      link.setAttribute("download", `${safeGroupName}_${dateRangeStr}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      Notify({ title: "Thành công", description: "Tải báo cáo Excel thành công!", status: "success" });
    } catch (err) {
      console.error(err);
      Notify({ title: "Lỗi", description: "Không thể xuất file Excel", status: "error" });
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (activeTab === "stats") {
      fetchAdminStats();
    }
  }, [activeTab, statsStartDate, statsEndDate, statsGroupId]);

  useEffect(() => {
    setStatsStartDate("");
    setStatsEndDate("");
  }, [statsPeriod]);

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
      setUserGroupId(item.groupId !== null && item.groupId !== undefined ? String(item.groupId) : "");
    } else {
      setEditingUser(null);
      setFormUserId("");
      setUserUsername("");
      setUserComputerId("");
      setUserRole("user");
      setUserGroupId("");
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

  // Clear WEB- devices
  const handleClearWebDevices = async (userId: string | number, currentDevices: any) => {
    if (!window.confirm("Bạn có chắc chắn muốn dọn dẹp các mã thiết bị rác (WEB-)? Hành động này sẽ giữ lại mã UUID vật lý gốc.")) return;
    try {
      const newDevices: any = {};
      if (currentDevices) {
         Object.entries(currentDevices).forEach(([deviceId, info]) => {
             if (!deviceId.startsWith('WEB-')) {
                 newDevices[deviceId] = info;
             }
         });
      }

      await updateAutomationUser(Number(userId), { knownDevices: newDevices } as any);
      setAutomationUsers(prev => 
        prev.map(u => u.id === userId ? { ...u, knownDevices: newDevices } : u)
      );
      Notify({ title: "Thành công", description: `Đã dọn dẹp thiết bị rác.`, status: "success" });
    } catch (err) {
      Notify({ title: "Lỗi", description: "Không thể dọn dẹp", status: "error" });
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
      } else if (activeTab === "groups") {
        await Promise.all(selectedKeys.map(id => deleteGroup(Number(id))));
      } else if (activeTab === "notifications") {
        await Promise.all(selectedKeys.map(id => deleteNotificationService(Number(id))));
      }
      Notify({ title: "Thành công", description: `Đã xóa ${selectedKeys.length} mục.`, status: "success" });
      setSelectedKeys([]);
      loadData();
    } catch (err) {
      Notify({ title: "Lỗi xóa hàng loạt", description: "Có lỗi xảy ra khi xóa các mục đã chọn.", status: "error" });
      setLoading(false);
    }
  };

  // Save Notification
  const handleSaveNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notificationFormData.title.trim() || !notificationFormData.content.trim()) {
      Notify({ title: "Lỗi biểu mẫu", description: "Vui lòng nhập đủ tiêu đề và nội dung", status: "warning" });
      return;
    }
    try {
      if (editingNotification) {
        await updateNotificationService(editingNotification.id, notificationFormData);
        Notify({ title: "Thành công", description: "Cập nhật thông báo thành công!", status: "success" });
      } else {
        await createNotificationService(notificationFormData);
        Notify({ title: "Thành công", description: "Tạo thông báo thành công!", status: "success" });
      }
      setIsNotificationModalOpen(false);
      loadData();
    } catch (error: any) {
      Notify({ title: "Lỗi", description: "Có lỗi xảy ra khi lưu thông báo", status: "error" });
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
      let savedUser;
      if (editingUser) {
        savedUser = await updateAutomationUser(editingUser.id, {
          username: userUsername.trim(),
          computerId: userComputerId.trim(),
          role: userRole
        });
        Notify({ title: "Thành công", description: "Cập nhật thông tin người dùng thành công!", status: "success" });
      } else {
        savedUser = await createAutomationUser({
          username: userUsername.trim(),
          computerId: userComputerId.trim(),
          role: userRole,
          isHeadless: true
        });
        Notify({ title: "Thành công", description: "Thêm người dùng mới thành công!", status: "success" });
      }

      const targetUserId = editingUser ? editingUser.id : (savedUser as any).id;
      if (targetUserId) {
        await assignUserToGroup(targetUserId, userGroupId ? Number(userGroupId) : null);
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

  // Save Group
  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      Notify({ title: "Lỗi biểu mẫu", description: "Tên nhóm không được để trống", status: "warning" });
      return;
    }
    try {
      if (editingGroup) {
        await updateGroup(editingGroup.id, { name: groupName.trim(), description: groupDescription.trim() });
        Notify({ title: "Thành công", description: "Cập nhật nhóm thành công!", status: "success" });
      } else {
        await createGroup({ name: groupName.trim(), description: groupDescription.trim() });
        Notify({ title: "Thành công", description: "Tạo nhóm mới thành công!", status: "success" });
      }
      setIsGroupModalOpen(false);
      loadData();
    } catch (error: any) {
      Notify({
        title: "Lỗi xử lý",
        description: error?.response?.data?.message || "Đã xảy ra lỗi khi lưu thông tin nhóm.",
        status: "error",
      });
    }
  };

  // Trigger delete group
  const triggerDeleteGroup = (id: number) => {
    setDeleteType("groups");
    setDeleteId(id);
    setIsDeleteOpen(true);
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
      } else if (deleteType === "groups") {
        await deleteGroup(deleteId);
        Notify({ title: "Xóa thành công", description: "Đã xóa nhóm khỏi hệ thống.", status: "success" });
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

  // Open Stats Modal
  const handleOpenStats = async (userRecord: any) => {
    setStatsUser(userRecord);
    setIsStatsModalOpen(true);
    setIsStatsLoading(true);
    try {
      const res = await getUserStats(userRecord.id);
      setStatsData(res);
    } catch (error: any) {
      Notify({
        title: "Lỗi",
        description: "Không thể lấy dữ liệu thống kê",
        status: "error"
      });
      setIsStatsModalOpen(false);
    } finally {
      setIsStatsLoading(false);
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

  const filteredUsers = React.useMemo(() => {
    return automationUsers.filter((u) => {
      const matchSearch = u.username.toLowerCase().includes(searchTerm.toLowerCase());
      const matchGroup = filterGroupId === ""
        ? true
        : filterGroupId === "none"
          ? !u.groupId && !u.group?.id
          : u.groupId === Number(filterGroupId) || u.group?.id === Number(filterGroupId);
      return matchSearch && matchGroup;
    });
  }, [automationUsers, searchTerm, filterGroupId]);

  const filteredGroups = React.useMemo(() => groups.filter((g) =>
    g.name.toLowerCase().includes(searchTerm.toLowerCase())
  ), [groups, searchTerm]);

  const filteredNotifications = React.useMemo(() => notifications.filter((n) =>
    n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    n.content.toLowerCase().includes(searchTerm.toLowerCase())
  ), [notifications, searchTerm]);

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
    { key: "actions", title: "Hành động", className: "text-right", render: (_, row) => (
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
    { key: "group", title: "Nhóm (Group)", render: (_, row) => row.group?.name || <span className="italic text-gray-400">Chưa vào nhóm</span> },
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
              
              {/* Button to clear WEB- garbage devices */}
              {Object.keys(row.knownDevices).some(id => id.startsWith('WEB-')) && (
                <button
                   onClick={() => handleClearWebDevices(row.id, row.knownDevices)}
                   className="mt-1 text-xs text-red-500 hover:text-red-700 underline text-left w-fit transition-colors"
                >
                   Dọn dẹp mã WEB-
                </button>
              )}
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
    { key: "actions", title: "Hành động", className: "text-right", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => handleOpenStats(row)}
          className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
          title="Thống kê"
        >
          <BarChart2 className="h-4 w-4" />
        </button>
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
    { key: "actions", title: "Hành động", className: "text-right", render: (_, row) => (
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

  const notificationColumns: TableColumn<INotification>[] = [
    { key: "id", title: "ID" },
    { key: "title", title: "Tiêu đề" },
    { key: "content", title: "Nội dung", render: (val) => <div className="max-w-xs truncate" title={val}>{val}</div> },
    { key: "isActive", title: "Trạng thái", render: (val: any) => val ? (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-semibold uppercase">Hiển thị</span>
    ) : (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-stone-100 text-stone-500 rounded-full text-xs font-semibold uppercase">Ẩn</span>
    ) },
    { key: "id", title: "Hành động", render: (_, row: any) => (
      <div className="flex items-center gap-2">
        <button onClick={() => {
          setEditingNotification(row);
          setNotificationFormData({ title: row.title, content: row.content, isActive: row.isActive });
          setIsNotificationModalOpen(true);
        }} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="Sửa">
          <Edit className="h-4 w-4" />
        </button>
        <button onClick={async () => {
          setDeleteId(row.id);
          setDeleteType("notifications" as any);
          setIsDeleteOpen(true);
        }} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition" title="Xóa">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    )}
  ];

  const groupColumns: TableColumn<IUserGroup>[] = [
    { key: "id", title: "ID Nhóm" },
    { key: "name", title: "Tên Nhóm" },
    { key: "description", title: "Mô tả", render: (_, row) => row.description || <span className="italic text-gray-300">Không có</span> },
    { key: "membersCount", title: "Số thành viên", render: (_, row) => {
      const count = row._count?.users || 0;
      return count > 0 ? (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shadow-sm">
           {count}
        </span>
      ) : (
        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-orange-500 text-white shadow-sm">
          {count}
        </span>
      );
    } },
    { key: "actions", title: "Hành động", className: "text-right", render: (_, row) => (
      <div className="flex justify-end space-x-2">
        <button
          onClick={() => {
            setEditingGroup(row);
            setGroupName(row.name);
            setGroupDescription(row.description || "");
            setIsGroupModalOpen(true);
          }}
          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
          title="Sửa"
        >
          <Edit className="h-4 w-4" />
        </button>
        <button
          onClick={() => triggerDeleteGroup(row.id)}
          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition"
          title="Xóa"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) }
  ];

  return (
    <div className="max-w-[95%] mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-16 text-gray-900">
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

        <Link
          href="/flow-ai"
          className="mt-4 sm:mt-0 inline-flex items-center space-x-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 bg-white hover:bg-gray-50 transition shadow-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Quay lại Dashboard</span>
        </Link>
      </div>

      {/* Tabs list & search filter */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div className="flex p-1 bg-gray-100 rounded-xl space-x-1 overflow-x-auto lg:overflow-visible max-w-full">
          <button
            onClick={() => {
              setActiveTab("flow");
              setSearchTerm("");
              setSelectedKeys([]);
              setFilterGroupId("");
            }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
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
              setFilterGroupId("");
            }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
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
              setFilterGroupId("");
            }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === "users"
                ? "bg-white text-emerald-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <MonitorPlay className="h-4 w-4" />
            <span>Người dùng ({automationUsers.length})</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("groups");
              setSearchTerm("");
              setSelectedKeys([]);
              setFilterGroupId("");
            }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === "groups"
                ? "bg-white text-emerald-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Users className="h-4 w-4 text-indigo-500" />
            <span>Nhóm ({groups.length})</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("stats");
              setSearchTerm("");
              setSelectedKeys([]);
              setFilterGroupId("");
            }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === "stats"
                ? "bg-white text-emerald-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <BarChart2 className="h-4 w-4 text-blue-500" />
            <span>Thống kê & Excel</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("notifications");
              setSearchTerm("");
              setSelectedKeys([]);
              setFilterGroupId("");
            }}
            className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
              activeTab === "notifications"
                ? "bg-white text-emerald-600 shadow"
                : "text-gray-500 hover:text-gray-900"
            }`}
          >
            <Bell className="h-4 w-4" />
            <span>Thông báo</span>
          </button>
        </div>

        {activeTab === "stats" ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setStatsStartDate("");
                setStatsEndDate("");
                setStatsGroupId("");
                setStatsPeriod("day");
                Notify({ title: "Đã xóa bộ lọc", description: "Các điều kiện lọc đã được thiết lập lại.", status: "success" });
              }}
              className="inline-flex items-center space-x-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition shadow-sm h-10 disabled:opacity-60 shrink-0"
              title="Xóa bộ lọc"
            >
              <X className="h-4 w-4" />
              <span>Xóa lọc</span>
            </button>
            <button
              onClick={async () => {
                await Promise.all([
                  loadData(),
                  fetchAdminStats()
                ]);
                Notify({ title: "Đã tải lại", description: "Dữ liệu mới nhất đã được cập nhật.", status: "success" });
              }}
              disabled={loading || isAdminStatsLoading}
              className="inline-flex items-center space-x-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition shadow-sm h-10 disabled:opacity-60 shrink-0 self-end"
              title="Tải lại dữ liệu"
            >
              <RefreshCw className={`h-4 w-4 ${(loading || isAdminStatsLoading) ? "animate-spin" : ""}`} />
              <span>Tải lại</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto flex-wrap">
            {activeTab === "users" && (
              <Select value={filterGroupId || "all"} onValueChange={(val) => setFilterGroupId(val === "all" ? "" : val)}>
                <SelectTrigger className="px-3 py-2.5 h-[42px] bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition text-gray-700 w-full sm:w-[180px] shrink-0 font-medium">
                  <SelectValue placeholder="Tất cả nhóm" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-gray-200 max-h-[250px] overflow-y-auto">
                  <SelectItem value="all">Tất cả nhóm</SelectItem>
                  <SelectItem value="none">Chưa vào nhóm</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={String(g.id)}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {activeTab !== "notifications" ? (
              <div className="relative flex-1 min-w-[200px] lg:w-64 shrink-0">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <Search className="h-4 w-4" />
                </span>
                <input
                  type="text"
                  placeholder={
                    activeTab === "flow" ? "Tìm email tài khoản Flow..." :
                    activeTab === "bas" ? "Tìm tên hoặc email liên kết..." :
                    activeTab === "users" ? "Tìm username người dùng..." :
                    activeTab === "groups" ? "Tìm tên nhóm..." :
                    "Tìm kiếm..."
                  }
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 pr-4 py-2.5 w-full bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                />
              </div>
            ) : (
              <div className="flex-1"></div>
            )}

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
                onClick={async () => {
                  await loadData();
                  Notify({ title: "Đã tải lại", description: "Dữ liệu mới nhất đã được cập nhật.", status: "success" });
                }}
                disabled={loading}
                className="inline-flex items-center space-x-2 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition shadow-sm h-10 disabled:opacity-60 shrink-0"
                title="Tải lại dữ liệu"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                <span>Tải lại</span>
              </button>

              <button
                onClick={() => {
                  if (activeTab === "flow") {
                    resetFlowForm();
                    setIsFlowModalOpen(true);
                  } else if (activeTab === "bas") {
                    resetBasForm();
                    setIsBasModalOpen(true);
                  } else if (activeTab === "groups") {
                    setEditingGroup(null);
                    setGroupName("");
                    setGroupDescription("");
                    setIsGroupModalOpen(true);
                  } else if (activeTab === "notifications") {
                    setEditingNotification(null);
                    setNotificationFormData({ title: '', content: '', isActive: true });
                    setIsNotificationModalOpen(true);
                  } else {
                    resetUserForm();
                    setIsUserModalOpen(true);
                  }
                }}
                className="inline-flex items-center space-x-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-600 text-white rounded-xl text-sm font-semibold hover:from-emerald-700 hover:to-emerald-700 shadow-md transition whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                <span>
                  {activeTab === "flow" ? "Thêm tài khoản Flow" :
                   activeTab === "bas" ? "Thêm tài khoản BAS" :
                   activeTab === "groups" ? "Thêm Nhóm" :
                   activeTab === "notifications" ? "Thêm Thông báo" :
                   "Thêm Người dùng"}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main content table */}
      <div className="mb-8">
        {activeTab === "stats" ? (
          <div className="space-y-6">
            {/* Sub-tab Navigation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2 rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-1.5 p-1 bg-gray-100/80 rounded-xl">
                <button
                  onClick={() => setStatsSubTab("ranking")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    statsSubTab === "ranking"
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <Trophy className="h-4 w-4 text-amber-500" />
                  <span>Bảng xếp hạng (Top Video)</span>
                </button>
                <button
                  onClick={() => setStatsSubTab("groups")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    statsSubTab === "groups"
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <Users className="h-4 w-4 text-indigo-500" />
                  <span>Thống kê theo Nhóm</span>
                </button>
                <button
                  onClick={() => setStatsSubTab("overview")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                    statsSubTab === "overview"
                      ? "bg-white text-emerald-700 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <BarChart2 className="h-4 w-4 text-emerald-500" />
                  <span>Tổng quan hệ thống</span>
                </button>
              </div>

              {/* Quick Time Presets */}
              <div className="flex items-center gap-1 bg-gray-50 p-1 rounded-xl border border-gray-200 text-xs">
                {[
                  { key: "all", label: "Tất cả" },
                  { key: "today", label: "Hôm nay" },
                  { key: "week", label: "Tuần này" },
                  { key: "month", label: "Tháng này" },
                  { key: "year", label: "Năm này" },
                ].map((item) => (
                  <button
                    key={item.key}
                    onClick={() => handleTimePresetChange(item.key as any)}
                    className={`px-3 py-1.5 rounded-lg font-medium transition ${
                      timePreset === item.key
                        ? "bg-emerald-600 text-white shadow-xs font-semibold"
                        : "text-gray-600 hover:bg-gray-200/60"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Toolbar Panel */}
            <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex flex-wrap items-end gap-4">
              <div className="w-44">
                <label className="block text-xs font-semibold text-gray-700 mb-1">Từ ngày</label>
                <DatePicker
                  value={statsStartDate ? new Date(statsStartDate) : null}
                  onChange={(date: Date | null) => {
                    setTimePreset("custom");
                    if (date) {
                      const offset = date.getTimezoneOffset();
                      const localDate = new Date(date.getTime() - (offset * 60 * 1000));
                      setStatsStartDate(localDate.toISOString().split("T")[0]);
                    } else {
                      setStatsStartDate("");
                    }
                  }}
                  className="w-full text-gray-700 text-sm"
                  placeholder="Chọn ngày"
                />
              </div>
              <div className="w-44">
                <label className="block text-xs font-semibold text-gray-700 mb-1">Đến ngày</label>
                <DatePicker
                  value={statsEndDate ? new Date(statsEndDate) : null}
                  onChange={(date: Date | null) => {
                    setTimePreset("custom");
                    if (date) {
                      const offset = date.getTimezoneOffset();
                      const localDate = new Date(date.getTime() - (offset * 60 * 1000));
                      setStatsEndDate(localDate.toISOString().split("T")[0]);
                    } else {
                      setStatsEndDate("");
                    }
                  }}
                  className="w-full text-gray-700 text-sm"
                  placeholder="Chọn ngày"
                />
              </div>
              <div className="w-48">
                <label className="block text-xs font-semibold text-gray-700 mb-1">Nhóm</label>
                <Select value={statsGroupId ? String(statsGroupId) : "all"} onValueChange={(val) => setStatsGroupId(val === "all" ? "" : val)}>
                  <SelectTrigger className="px-3 py-2 h-[38px] w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-white text-gray-700 font-medium">
                    <SelectValue placeholder="Tất cả nhóm" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-gray-200">
                    <SelectItem value="all">Tất cả nhóm</SelectItem>
                    {groups.map(g => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {statsSubTab === "ranking" && (
                <>
                  <div className="w-36">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Hiển thị Top</label>
                    <Select value={String(statsTopLimit)} onValueChange={(val) => setStatsTopLimit(val === "all" ? "all" : Number(val))}>
                      <SelectTrigger className="px-3 py-2 h-[38px] w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-white text-gray-700 font-medium">
                        <SelectValue placeholder="Top 10" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl border-gray-200">
                        <SelectItem value="5">Top 5</SelectItem>
                        <SelectItem value="10">Top 10</SelectItem>
                        <SelectItem value="20">Top 20</SelectItem>
                        <SelectItem value="50">Top 50</SelectItem>
                        <SelectItem value="all">Tất cả</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex-1 min-w-[200px]">
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Tìm thành viên</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={rankingSearchTerm}
                        onChange={(e) => setRankingSearchTerm(e.target.value)}
                        placeholder="Tìm theo username hoặc nhóm..."
                        className="pl-9 pr-3 py-1.5 h-[38px] w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                      />
                      {rankingSearchTerm && (
                        <button onClick={() => setRankingSearchTerm("")} className="absolute right-2.5 top-2.5 text-gray-400 hover:text-gray-600">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className="ml-auto">
                <button
                  onClick={handleExportExcel}
                  disabled={isExporting}
                  className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 shadow transition flex items-center justify-center gap-2 disabled:opacity-60 h-[38px]"
                >
                  {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                  <span>Xuất Excel</span>
                </button>
              </div>
            </div>

            {/* Content View */}
            {isAdminStatsLoading ? (
              <div className="py-16 flex flex-col items-center justify-center text-gray-500 bg-white rounded-2xl border border-gray-200 shadow-sm">
                <Loader2 className="h-10 w-10 animate-spin text-emerald-600 mb-4" />
                <p className="font-semibold text-gray-700">Đang phân tích số liệu hệ thống...</p>
                <p className="text-xs text-gray-400 mt-1">Vui lòng đợi trong giây lát</p>
              </div>
            ) : adminStatsData ? (
              <div className="space-y-6">
                {/* 1. RANKING SUB-TAB */}
                {statsSubTab === "ranking" && (() => {
                  const allRankings = (adminStatsData.userRanking || []) as any[];
                  const filteredRankings = allRankings.filter((u: any) => {
                    if (!rankingSearchTerm.trim()) return true;
                    const term = rankingSearchTerm.toLowerCase();
                    return (
                      (u.username && u.username.toLowerCase().includes(term)) ||
                      (u.email && u.email.toLowerCase().includes(term)) ||
                      (u.groupName && u.groupName.toLowerCase().includes(term))
                    );
                  });

                  const displayedRankings = statsTopLimit === "all" ? filteredRankings : filteredRankings.slice(0, Number(statsTopLimit));
                  const top1 = allRankings[0];
                  const top2 = allRankings[1];
                  const top3 = allRankings[2];

                  return (
                    <div className="space-y-6">
                      {/* TOP 3 PODIUM HERO SECTION */}
                      {allRankings.length > 0 && !rankingSearchTerm && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-end pt-4 pb-2">
                          {/* TOP 2 (SILVER) */}
                          <div className="order-2 md:order-1 bg-gradient-to-b from-slate-100 via-white to-white p-6 rounded-2xl border-2 border-slate-200 shadow-md relative flex flex-col items-center text-center transition hover:-translate-y-1">
                            <div className="absolute -top-4 px-3 py-1 bg-slate-200 text-slate-700 rounded-full text-xs font-bold uppercase tracking-wider border border-slate-300 shadow-xs flex items-center gap-1">
                              <Medal className="h-3.5 w-3.5 text-slate-500" />
                              <span>Á Quân 1</span>
                            </div>
                            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-slate-400 to-slate-200 p-1 flex items-center justify-center shadow-inner mt-2 mb-3">
                              <div className="w-full h-full rounded-full bg-white flex items-center justify-center font-black text-xl text-slate-600">
                                {top2 ? top2.username.charAt(0).toUpperCase() : "2"}
                              </div>
                            </div>
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 mb-1">
                              <span>Hạng 2</span>
                            </div>
                            <h4 className="font-bold text-gray-900 text-lg line-clamp-1">{top2 ? top2.username : "Chưa có"}</h4>
                            <p className="text-xs text-gray-500 mb-3">{top2 ? top2.groupName : "--"}</p>
                            <div className="w-full bg-slate-50 py-2.5 px-4 rounded-xl border border-slate-100 flex items-center justify-between text-xs font-medium text-slate-600">
                              <span>Video hoàn thành:</span>
                              <span className="text-base font-bold text-slate-900">{top2 ? top2.completed : 0}</span>
                            </div>
                          </div>

                          {/* TOP 1 (GOLD) - ELEVATED */}
                          <div className="order-1 md:order-2 bg-gradient-to-b from-amber-500/15 via-amber-500/5 to-white p-7 rounded-3xl border-2 border-amber-400 shadow-xl shadow-amber-500/10 relative flex flex-col items-center text-center transition hover:-translate-y-1 md:-mt-4">
                            <div className="absolute -top-5 px-4 py-1.5 bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-400 text-amber-950 rounded-full text-xs font-black uppercase tracking-wider shadow-md flex items-center gap-1.5 border border-amber-300">
                              <Crown className="h-4 w-4 text-amber-900 fill-amber-900 animate-bounce" />
                              <span>QUÁN QUÂN 🏆</span>
                            </div>
                            <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-amber-500 via-yellow-400 to-amber-200 p-1 flex items-center justify-center shadow-lg shadow-amber-400/30 mt-1 mb-3">
                              <div className="w-full h-full rounded-full bg-white flex items-center justify-center font-black text-2xl text-amber-600">
                                {top1 ? top1.username.charAt(0).toUpperCase() : "1"}
                              </div>
                            </div>
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300/60 mb-1">
                              <Trophy className="h-3.5 w-3.5 text-amber-600 fill-amber-500" />
                              <span>TOP 1 LEADERBOARD</span>
                            </div>
                            <h4 className="font-black text-gray-900 text-xl line-clamp-1">{top1 ? top1.username : "Chưa có"}</h4>
                            <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md mt-0.5 mb-4">{top1 ? top1.groupName : "--"}</p>
                            <div className="w-full bg-gradient-to-r from-amber-500/10 via-yellow-500/10 to-amber-500/10 py-3 px-4 rounded-2xl border border-amber-200/80 flex items-center justify-between text-sm font-semibold text-amber-900">
                              <span className="flex items-center gap-1">
                                <Sparkles className="h-4 w-4 text-amber-500" />
                                <span>Thành công:</span>
                              </span>
                              <span className="text-xl font-black text-amber-700">{top1 ? top1.completed : 0} vid</span>
                            </div>
                          </div>

                          {/* TOP 3 (BRONZE) */}
                          <div className="order-3 bg-gradient-to-b from-orange-50 via-white to-white p-6 rounded-2xl border-2 border-orange-200 shadow-md relative flex flex-col items-center text-center transition hover:-translate-y-1">
                            <div className="absolute -top-4 px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-xs font-bold uppercase tracking-wider border border-orange-200 shadow-xs flex items-center gap-1">
                              <Medal className="h-3.5 w-3.5 text-orange-600" />
                              <span>Á Quân 2</span>
                            </div>
                            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-amber-700 via-orange-400 to-amber-200 p-1 flex items-center justify-center shadow-inner mt-2 mb-3">
                              <div className="w-full h-full rounded-full bg-white flex items-center justify-center font-black text-xl text-orange-700">
                                {top3 ? top3.username.charAt(0).toUpperCase() : "3"}
                              </div>
                            </div>
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 mb-1">
                              <span>Hạng 3</span>
                            </div>
                            <h4 className="font-bold text-gray-900 text-lg line-clamp-1">{top3 ? top3.username : "Chưa có"}</h4>
                            <p className="text-xs text-gray-500 mb-3">{top3 ? top3.groupName : "--"}</p>
                            <div className="w-full bg-orange-50/60 py-2.5 px-4 rounded-xl border border-orange-100 flex items-center justify-between text-xs font-medium text-orange-800">
                              <span>Video hoàn thành:</span>
                              <span className="text-base font-bold text-orange-950">{top3 ? top3.completed : 0}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* DETAILED LEADERBOARD TABLE */}
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 bg-gray-50/80 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2 font-bold text-gray-900 text-base">
                            <Trophy className="h-5 w-5 text-amber-500" />
                            <span>Bảng Xếp Hạng Chi Tiết ({displayedRankings.length} thành viên)</span>
                          </div>
                          {statsTopLimit !== "all" && (
                            <span className="text-xs text-gray-500 bg-white px-3 py-1 rounded-lg border border-gray-200 font-medium">
                              Đang lọc hiển thị Top {statsTopLimit}
                            </span>
                          )}
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm text-gray-600">
                            <thead className="bg-gray-100/70 text-gray-700 uppercase font-semibold text-xs border-b border-gray-200">
                              <tr>
                                <th className="px-6 py-3.5 text-center w-20">Hạng</th>
                                <th className="px-6 py-3.5">Thành viên</th>
                                <th className="px-6 py-3.5">Nhóm</th>
                                <th className="px-6 py-3.5 text-center">Thành công</th>
                                <th className="px-6 py-3.5 text-center">Đang xử lý</th>
                                <th className="px-6 py-3.5 text-center">Thất bại</th>
                                <th className="px-6 py-3.5 text-center">Tổng video</th>
                                <th className="px-6 py-3.5 text-center">Tỉ lệ hoàn thành</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {displayedRankings.length > 0 ? (
                                displayedRankings.map((user: any) => {
                                  const rank = user.ranking;
                                  return (
                                    <tr
                                      key={user.id}
                                      className={`hover:bg-emerald-50/30 transition ${
                                        rank === 1 ? "bg-amber-50/30 font-medium" :
                                        rank === 2 ? "bg-slate-50/40" :
                                        rank === 3 ? "bg-orange-50/20" : ""
                                      }`}
                                    >
                                      {/* Rank Column */}
                                      <td className="px-6 py-4 text-center">
                                        {rank === 1 ? (
                                          <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-amber-400 to-yellow-300 text-amber-950 font-black shadow-sm">
                                            🥇
                                          </div>
                                        ) : rank === 2 ? (
                                          <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-slate-300 to-slate-200 text-slate-800 font-bold shadow-xs">
                                            🥈
                                          </div>
                                        ) : rank === 3 ? (
                                          <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-r from-amber-600 to-orange-400 text-white font-bold shadow-xs">
                                            🥉
                                          </div>
                                        ) : (
                                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold text-xs">
                                            {rank}
                                          </span>
                                        )}
                                      </td>

                                      {/* User Info */}
                                      <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                          <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-sm flex items-center justify-center shadow-xs">
                                            {user.username.charAt(0).toUpperCase()}
                                          </div>
                                          <div>
                                            <p className="font-bold text-gray-900 leading-tight">{user.username}</p>
                                            {user.email && <p className="text-xs text-gray-400 mt-0.5">{user.email}</p>}
                                          </div>
                                        </div>
                                      </td>

                                      {/* Group */}
                                      <td className="px-6 py-4">
                                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700">
                                          {user.groupName || "Chưa vào nhóm"}
                                        </span>
                                      </td>

                                      {/* Completed */}
                                      <td className="px-6 py-4 text-center">
                                        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                          <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                                          <span>{user.completed}</span>
                                        </span>
                                      </td>

                                      {/* Processing */}
                                      <td className="px-6 py-4 text-center">
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                                          <Clock className="h-3 w-3 text-amber-500" />
                                          <span>{user.processing}</span>
                                        </span>
                                      </td>

                                      {/* Failed */}
                                      <td className="px-6 py-4 text-center">
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700">
                                          <XCircle className="h-3 w-3 text-red-500" />
                                          <span>{user.failed}</span>
                                        </span>
                                      </td>

                                      {/* Total */}
                                      <td className="px-6 py-4 text-center font-bold text-gray-900 text-sm">
                                        {user.total}
                                      </td>

                                      {/* Success Rate */}
                                      <td className="px-6 py-4 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                          <span className="text-xs font-bold text-emerald-700">{user.successRate}</span>
                                          <div className="w-16 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                            <div
                                              className="bg-emerald-600 h-1.5 rounded-full"
                                              style={{ width: user.successRate }}
                                            />
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })
                              ) : (
                                <tr>
                                  <td colSpan={8} className="py-12 text-center text-gray-400">
                                    Không tìm thấy dữ liệu xếp hạng phù hợp với bộ lọc.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* 2. GROUP STATS SUB-TAB */}
                {statsSubTab === "groups" && (
                  <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 font-bold text-gray-900 flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-indigo-600" />
                        <span>Thống kê theo Nhóm làm việc</span>
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-100/70 text-gray-700 uppercase font-semibold text-xs border-b border-gray-200">
                          <tr>
                            <th className="px-6 py-3.5">Tên Nhóm</th>
                            <th className="px-6 py-3.5 text-center">Thành công</th>
                            <th className="px-6 py-3.5 text-center">Đang xử lý</th>
                            <th className="px-6 py-3.5 text-center">Thất bại</th>
                            <th className="px-6 py-3.5 text-center">Tổng cộng</th>
                            <th className="px-6 py-3.5 text-center">Tỉ lệ thành công</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {adminStatsData.groups.map((g: any, index: number) => {
                            const resolved = g.completed + g.failed;
                            const rate = resolved > 0 ? ((g.completed / resolved) * 100).toFixed(2) + '%' : '0%';
                            return (
                              <tr key={index} className="hover:bg-gray-50 transition">
                                <td className="px-6 py-4 font-bold text-gray-900">{g.name}</td>
                                <td className="px-6 py-4 text-center font-bold text-emerald-600">{g.completed}</td>
                                <td className="px-6 py-4 text-center text-amber-600 font-medium">{g.processing}</td>
                                <td className="px-6 py-4 text-center text-red-600 font-medium">{g.failed}</td>
                                <td className="px-6 py-4 text-center font-bold text-gray-900">{g.total}</td>
                                <td className="px-6 py-4 text-center font-bold text-indigo-600">{rate}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 3. OVERVIEW SUB-TAB */}
                {statsSubTab === "overview" && (
                  <div className="space-y-6">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between">
                        <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Tổng số Video</p>
                        <h3 className="text-3xl font-black text-gray-900 mt-2">{adminStatsData.summary.total}</h3>
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between border-l-4 border-l-emerald-500">
                        <p className="text-xs text-emerald-600 font-semibold uppercase tracking-wider">Thành công</p>
                        <h3 className="text-3xl font-black text-emerald-700 mt-2">{adminStatsData.summary.completed}</h3>
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between border-l-4 border-l-red-500">
                        <p className="text-xs text-red-600 font-semibold uppercase tracking-wider">Thất bại</p>
                        <h3 className="text-3xl font-black text-red-700 mt-2">{adminStatsData.summary.failed}</h3>
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between border-l-4 border-l-amber-500">
                        <p className="text-xs text-amber-600 font-semibold uppercase tracking-wider">Đang xử lý</p>
                        <h3 className="text-3xl font-black text-amber-700 mt-2">{adminStatsData.summary.processing}</h3>
                      </div>
                      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-between bg-gradient-to-tr from-indigo-50 to-blue-50 border-l-4 border-l-indigo-500">
                        <p className="text-xs text-indigo-600 font-semibold uppercase tracking-wider">Tỷ lệ thành công</p>
                        <h3 className="text-3xl font-black text-indigo-700 mt-2">{adminStatsData.summary.successRate}</h3>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-16 text-center text-gray-500 bg-white rounded-2xl border border-gray-200 shadow-sm">
                <BarChart2 className="h-10 w-10 text-gray-300 mx-auto mb-2" />
                <p className="font-semibold text-gray-600">Không có dữ liệu thống kê cho khoảng thời gian này.</p>
                <p className="text-xs text-gray-400 mt-1">Hãy thử chọn mốc thời gian khác hoặc kiểm tra lại bộ lọc.</p>
              </div>
            )}
          </div>
        ) : (
          <CustomTable<any>
            data={
              activeTab === "flow" ? filteredFlows :
              activeTab === "users" ? filteredUsers :
              activeTab === "groups" ? filteredGroups :
              activeTab === "notifications" ? filteredNotifications :
              filteredBases
            }
            columns={
              (activeTab === "flow" ? flowColumns :
              activeTab === "users" ? userColumns :
              activeTab === "groups" ? groupColumns :
              activeTab === "notifications" ? notificationColumns :
              basColumns) as any
            }
            loading={loading}
            enableSelection={true}
            onSelectionChange={setSelectedKeys}
            enablePagination={false}
          />
        )}
      </div>

      {/* NOTIFICATION MODAL */}
      {isNotificationModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full overflow-hidden border border-gray-100 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingNotification ? "Sửa thông báo" : "Thêm mới thông báo"}
              </h2>
              <button
                onClick={() => setIsNotificationModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveNotification}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tiêu đề</label>
                  <input
                    required
                    type="text"
                    value={notificationFormData.title}
                    onChange={(e) => setNotificationFormData({ ...notificationFormData, title: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                    placeholder="VD: Những thay đổi ở phiên bản v1.0.1"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nội dung</label>
                  <textarea
                    required
                    rows={8}
                    value={notificationFormData.content}
                    onChange={(e) => setNotificationFormData({ ...notificationFormData, content: e.target.value })}
                    className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                    placeholder="Nhập nội dung các thay đổi..."
                  />
                </div>
                <div className="flex items-center gap-2 mt-4">
                  <label className="cursor-pointer flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={notificationFormData.isActive}
                      onChange={(e) => setNotificationFormData({ ...notificationFormData, isActive: e.target.checked })}
                      className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                    />
                    Hiển thị thông báo này trên ứng dụng
                  </label>
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsNotificationModalOpen(false)}
                  className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50 transition"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-gradient-to-r from-emerald-600 to-emerald-600 text-white rounded-xl text-sm font-semibold hover:from-emerald-700 hover:to-emerald-700 shadow-md transition"
                >
                  Lưu lại
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                  <Select value={basFlowAccountId ? String(basFlowAccountId) : "none"} onValueChange={(val) => setBasFlowAccountId(val === "none" ? "" : Number(val))}>
                    <SelectTrigger className="px-4 py-2 h-[38px] w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-white text-gray-700">
                      <SelectValue placeholder="-- Chưa liên kết tài khoản nào --" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-gray-200">
                      <SelectItem value="none">-- Chưa liên kết tài khoản nào --</SelectItem>
                      {flowAccounts.map((flow) => (
                        <SelectItem key={flow.id} value={String(flow.id)}>
                          {flow.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                  <Select value={userRole} onValueChange={(val) => setUserRole(val)}>
                    <SelectTrigger className="px-4 py-2 h-[38px] w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-white text-gray-700">
                      <SelectValue placeholder="Chọn vai trò" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-gray-200">
                      <SelectItem value="user">User thường</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Nhóm (Group)</label>
                  <Select value={userGroupId ? String(userGroupId) : "none"} onValueChange={(val) => setUserGroupId(val === "none" ? "" : val)}>
                    <SelectTrigger className="px-4 py-2 h-[38px] w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition bg-white text-gray-700">
                      <SelectValue placeholder="-- Chưa vào nhóm --" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-gray-200">
                      <SelectItem value="none">-- Chưa vào nhóm --</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={String(g.id)}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

      {/* USER GROUP MODAL */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-gray-100 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900">
                {editingGroup ? "Sửa nhóm người dùng" : "Thêm nhóm người dùng"}
              </h2>
              <button
                onClick={() => setIsGroupModalOpen(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveGroup}>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Tên nhóm</label>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="Nhập tên nhóm..."
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Mô tả nhóm</label>
                  <input
                    type="text"
                    value={groupDescription}
                    onChange={(e) => setGroupDescription(e.target.value)}
                    placeholder="Mô tả cho nhóm này..."
                    className="px-4 py-2 w-full border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsGroupModalOpen(false)}
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

      {/* STATS MODAL */}
      {isStatsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-gray-100 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center px-6 py-4 bg-gray-50 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <BarChart2 className="h-5 w-5 text-blue-600" />
                Thống kê hoạt động
              </h2>
              <button
                onClick={() => {
                  setIsStatsModalOpen(false);
                  setStatsData(null);
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="mb-6 flex items-center gap-3 bg-gray-50 p-4 rounded-xl border border-gray-100">
                <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
                  {statsUser?.username?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{statsUser?.username}</h3>
                  <p className="text-sm text-gray-500">ID: {statsUser?.id} • Vai trò: {statsUser?.role}</p>
                </div>
              </div>

              {isStatsLoading ? (
                <div className="py-8 flex flex-col items-center justify-center text-gray-500">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-600 mb-3" />
                  <p>Đang phân tích dữ liệu...</p>
                </div>
              ) : statsData ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-xl border border-blue-100 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-blue-600 font-medium">Tổng số Video</p>
                      <h4 className="text-3xl font-bold text-blue-900 mt-1">{statsData.total}</h4>
                    </div>
                    <div className="h-12 w-12 bg-blue-200/50 rounded-full flex items-center justify-center">
                      <Database className="h-6 w-6 text-blue-700" />
                    </div>
                  </div>
                  
                  <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                    <p className="text-sm text-emerald-600 font-medium">Thành công</p>
                    <h4 className="text-2xl font-bold text-emerald-700 mt-1">{statsData.completed}</h4>
                  </div>
                  
                  <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                    <p className="text-sm text-red-600 font-medium">Thất bại</p>
                    <h4 className="text-2xl font-bold text-red-700 mt-1">{statsData.failed}</h4>
                  </div>
                  
                  <div className="col-span-2 bg-amber-50 p-4 rounded-xl border border-amber-100 flex items-center justify-between">
                    <div>
                      <p className="text-sm text-amber-600 font-medium">Đang chờ / Đang xử lý</p>
                      <h4 className="text-2xl font-bold text-amber-700 mt-1">{statsData.processing}</h4>
                    </div>
                    <div className="h-10 w-10 bg-amber-200/50 rounded-full flex items-center justify-center">
                      <Loader2 className="h-5 w-5 text-amber-700" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center text-gray-500">Không có dữ liệu.</div>
              )}
            </div>
            
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => {
                  setIsStatsModalOpen(false);
                  setStatsData(null);
                }}
                className="px-4 py-2 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-100 transition font-medium"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
