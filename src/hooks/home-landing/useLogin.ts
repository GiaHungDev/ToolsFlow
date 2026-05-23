import { Notify } from "@/lib/Notify";
import { checkMe, login } from "@/lib/redux/slices/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/store";
import { useRouter } from "next/navigation";

export const useLogin = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();

  const { user, loading } = useAppSelector((state) => state.auth);

  const handleLogin = async (credentials: any) => {
    try {
      await dispatch(login(credentials)).unwrap();
      await dispatch(checkMe()).unwrap();
      
      // Save for auto-fill in LoginModal
      if (typeof window !== 'undefined') {
        localStorage.setItem('username', credentials.username);
        localStorage.setItem('saved_password', credentials.password);
      }
      
      router.push("/");
    } catch (error: any) {
      console.error("Login error:", error);
      let des = error?.message || "Không thể đăng nhập, vui lòng thử lại sau";
      
      // Bắt lỗi liên quan đến thiết bị/computerID
      const errorMessageLower = des.toLowerCase();
      if (errorMessageLower.includes("computerid") || errorMessageLower.includes("computer id") || errorMessageLower.includes("device")) {
        des = "Mã thiết bị (ComputerID) chưa được đăng kí trên hệ thống, Vui lòng liên hệ admin.";
      }

      Notify({
        title: "Lỗi đăng nhập",
        description: des,
        status: "error",
      });
      throw error;
    }
  };

  return {
    handleLogin,
    // redux
    user,
    loading,
    // state
  };
};
