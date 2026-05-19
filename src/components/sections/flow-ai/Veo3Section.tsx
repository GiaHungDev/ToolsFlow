"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, Server, FileText, MonitorPlay, Key, FileUp, ListRestart, Minus, Plus, Settings, Save } from "lucide-react";
import { Notify } from "@/lib/Notify";
import { useAppSelector } from "@/lib/redux/store";

const Veo3Section = () => {
  const { user } = useAppSelector((state) => state.auth);
  const [threadCount, setThreadCount] = useState<number>(1);
  const [loginMethod, setLoginMethod] = useState<"account" | "cookie" | "tool">("cookie");
  const [importMethod, setImportMethod] = useState<"text" | "file">("text");
  const [accountData, setAccountData] = useState({ email: "", password: "", twoFA: "" });
  const [cookieData, setCookieData] = useState("");
  const [toolAccount, setToolAccount] = useState("");
  const [chromePath, setChromePath] = useState("");
  const [isConfigSaved, setIsConfigSaved] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [jobProgress, setJobProgress] = useState<Record<string, number>>({});
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (!user?.id) return;
    
    const userId = user.id;

    const savedAccount = localStorage.getItem(`veo3_${userId}_account`);
    if (savedAccount) {
      setAccountData(JSON.parse(savedAccount));
    } else {
      setAccountData({ email: "", password: "", twoFA: "" });
    }

    const savedCookie = localStorage.getItem(`veo3_${userId}_cookie`);
    setCookieData(savedCookie || "");

    const savedChromePath = localStorage.getItem(`veo3_${userId}_chrome_path`);
    if (savedChromePath) {
      setChromePath(savedChromePath);
      // Auto-lock if they already have the required Chrome Path
      setIsConfigSaved(true);
    } else {
      setChromePath("");
      setIsConfigSaved(false);
    }

    const savedToolAccount = localStorage.getItem(`veo3_${userId}_tool_account`);
    setToolAccount(savedToolAccount || "");

    const savedLoginMethod = localStorage.getItem(`veo3_${userId}_login_method`) as "account" | "cookie" | "tool";
    if (savedLoginMethod) {
      if (savedLoginMethod === "account") {
        setLoginMethod("cookie"); // Default to cookie if account is temporarily disabled
      } else {
        setLoginMethod(savedLoginMethod);
      }
    } else {
      setLoginMethod("cookie");
    }

    const savedThreadCount = localStorage.getItem(`veo3_${userId}_thread_count`);
    if (savedThreadCount) {
      setThreadCount(Number(savedThreadCount));
    } else {
      setThreadCount(1);
    }
  }, [user?.id]);

  // Tự động kiểm tra trạng thái chạy ngầm khi tải trang
  useEffect(() => {
    const checkRunningStatus = async () => {
      try {
        const response = await fetch('/api/veo3/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' })
        });
        if (response.ok) {
          const data = await response.json();
          if (data.isRunning) {
            handlePlay(true);
          }
        }
      } catch (e) {}
    };
    setTimeout(checkRunningStatus, 300);
  }, []);

  const handleAccountChange = (field: keyof typeof accountData, value: string) => {
    const newData = { ...accountData, [field]: value };
    setAccountData(newData);
    if (user?.id) {
      localStorage.setItem(`veo3_${user.id}_account`, JSON.stringify(newData));
    }
  };

  const handleCookieChange = (value: string) => {
    setCookieData(value);
    if (user?.id) {
      localStorage.setItem(`veo3_${user.id}_cookie`, value);
    }
  };

  const handleToolAccountChange = (value: string) => {
    setToolAccount(value);
    if (user?.id) {
      localStorage.setItem(`veo3_${user.id}_tool_account`, value);
    }
  };

  const handleChromePathChange = (value: string) => {
    setChromePath(value);
    if (user?.id) {
      localStorage.setItem(`veo3_${user.id}_chrome_path`, value);
    }
  };

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleSaveConfig = () => {
    if (!chromePath.trim()) {
      Notify({ title: "Thiếu thông tin", description: "Đường dẫn Chrome là bắt buộc!", status: "warning" });
      return;
    }
    if (loginMethod === "account" && importMethod === "text" && (!accountData.email || !accountData.password || !accountData.twoFA)) {
      Notify({ title: "Thiếu thông tin", description: "Vui lòng nhập đầy đủ Email, Mật khẩu và Mã 2FA!", status: "warning" });
      return;
    }
    if (loginMethod === "cookie" && importMethod === "text" && !cookieData.trim()) {
      Notify({ title: "Thiếu thông tin", description: "Vui lòng nhập Cookies!", status: "warning" });
      return;
    }
    if (loginMethod === "tool" && !toolAccount.trim()) {
      Notify({ title: "Thiếu thông tin", description: "Vui lòng nhập Tài khoản tools BAS!", status: "warning" });
      return;
    }
    setIsConfigSaved(true);
    Notify({ title: "Đã lưu", description: "Cấu hình đã được lưu và khóa lại.", status: "success" });
  };

  const handlePlay = async (isReconnecting = false) => {
    if (!isReconnecting && !isConfigSaved) {
      Notify({ title: "Chưa lưu cấu hình", description: "hãy lưu cấu hình trước khi bắt đầu", status: "warning" });
      return;
    }
    // The validation is already handled in handleSaveConfig
    setIsRunning(true);
    if (!isReconnecting) {
      addLog(`Khởi chạy Veo3 với ${threadCount} luồng...`);
      addLog(`Phương thức: ${loginMethod === "account" ? "Tài khoản GG" : loginMethod === "tool" ? "Tài khoản tool" : "Cookies"}`);
    } else {
      addLog("Đang kết nối lại luồng chạy ngầm của Veo3...");
    }

    // Lấy token thực tế từ dự án
    let token = "";
    if (typeof window !== "undefined") {
      token = localStorage.getItem("access_token") || localStorage.getItem("accessToken") || localStorage.getItem("token") || "";
    }

    try {
      const response = await fetch('/api/veo3/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          threadCount,
          loginMethod,
          accountData: loginMethod === "account" ? accountData : null,
          cookieData: loginMethod === "cookie" ? cookieData : null,
          toolAccount: loginMethod === "tool" ? toolAccount : null,
          chromePath,
          isReconnecting,
        }),
      });

      if (!response.body) {
        addLog("[LỖI] Không thể kết nối đến luồng log server.");
        setIsRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      // Nếu khởi chạy mới hoàn toàn thì clear logs cũ
      if (!isReconnecting) {
        setLogs([]);
      }

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          setIsRunning(false);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "");
            if (dataStr === "[DONE]") {
              setIsRunning(false);
              break;
            }
            try {
              const dataObj = JSON.parse(dataStr);
              if (dataObj.log) {
                const logText = dataObj.log;
                // Lọc những log rác không có giá trị
                if (logText.includes("Ignoring extra certs") || logText.includes("PEM routines::ASN1 lib")) continue;
                if (logText.includes("[Master][Account") && logText.endsWith("Pipeline")) continue;
                if (logText.replace(/^\[.*?\]\s*/, '').trim() === '') continue; // Bỏ qua log trống
                if (logText.includes("Đang kiểm tra tiến độ Job")) continue; // Bỏ qua log kiểm tra lặp lại
                if (logText.includes("chuyển sang: Rendering")) continue; // Rendering bị lặp nhiều lần

                // Xử lý thông minh log tiến trình (VD: Tiến trình Job 233: 4%)
                const progressMatch = logText.match(/Tiến trình Job (.*?):\s*(\d+)%/);
                if (progressMatch) {
                  const jobId = progressMatch[1];
                  const percent = parseInt(progressMatch[2], 10);
                  setJobProgress((prev) => ({ ...prev, [jobId]: percent }));
                  continue; // Không in ra text log nữa để đỡ rối
                }

                // Xử lý hoàn thành hoặc thất bại
                const statusMatch = logText.match(/\[TRẠNG THÁI\] Job (.*?) chuyển sang: (Completed|Failed)/);
                if (statusMatch) {
                  const jobId = statusMatch[1];
                  const status = statusMatch[2];

                  setJobProgress((prev) => {
                    const newProg = { ...prev };
                    delete newProg[jobId];
                    return newProg;
                  });

                  if (status === "Completed") {
                    setLogs((prev) => [...prev, `✅ [HOÀN THÀNH] Job ${jobId} đã render và tạo thành công!`]);
                  } else {
                    setLogs((prev) => [...prev, `❌ [THẤT BẠI] Job ${jobId} đã xảy ra lỗi.`]);
                  }
                  continue;
                }

                // Không thêm timestamp vì backend/tool đã có timestamp rồi
                setLogs((prev) => [...prev, logText]);
              }
            } catch (e) { }
          }
        }
      }
    } catch (error: any) {
      addLog(`[LỖI] Lỗi kết nối Server: ${error.message}`);
      setIsRunning(false);
    }
  };

  const handlePause = async () => {
    setIsRunning(false);
    addLog("Đang yêu cầu dừng tiến trình chạy ngầm...");
    try {
      await fetch('/api/veo3/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' })
      });
      addLog("Đã tạm dừng quá trình xử lý.");
    } catch (e: any) {
      addLog(`[LỖI] Không thể gửi yêu cầu dừng: ${e.message}`);
    }
  };

  const handleClearLogs = () => {
    setLogs([]);
    setJobProgress({});
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      addLog(`Đã chọn file: ${file.name}`);
      // Normally you'd parse the file here
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-[1500px] mx-auto p-4 md:px-8 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
              <MonitorPlay className="w-6 h-6 text-emerald-500" />
              Veo3 Automation
            </h2>
            <p className="text-sm text-stone-500 mt-1">Cấu hình và chạy tự động trình duyệt Chrome thật cho tác vụ Veo3</p>
          </div>
          <div className="flex items-center gap-3">
            {!isRunning ? (
              <button
                onClick={() => handlePlay(false)}
                className="flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl transition shadow-lg shadow-emerald-200"
              >
                <Play className="w-5 h-5" /> Bắt đầu
              </button>
            ) : (
              <button
                onClick={handlePause}
                className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition shadow-lg shadow-amber-200"
              >
                <Pause className="w-5 h-5" /> Tạm dừng
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pb-8">
          {/* Configuration Section */}
          <div className="lg:col-span-4 bg-white p-6 rounded-2xl border border-stone-100 shadow-sm space-y-6 h-fit">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="text-lg font-bold text-stone-800">Cấu hình</h3>
              {isConfigSaved ? (
                <button
                  type="button"
                  onClick={() => setIsConfigSaved(false)}
                  disabled={isRunning}
                  className="p-1.5 text-stone-500 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition disabled:opacity-50"
                  title="Chỉnh sửa cấu hình"
                >
                  <Settings className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={isRunning}
                  className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg text-sm font-semibold transition disabled:opacity-50"
                >
                  <Save className="w-4 h-4" /> Lưu
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">Số luồng đồng thời</label>
                <div className="flex items-center w-full bg-stone-50 border border-stone-200 rounded-xl overflow-hidden transition-all focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-200">
                  <button
                    type="button"
                    onClick={() => setThreadCount((prev) => {
                      const val = Math.max(1, prev - 1);
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_thread_count`, val.toString());
                      }
                      return val;
                    })}
                    disabled={isRunning || isConfigSaved || threadCount <= 1}
                    className="p-3 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Minus className="w-5 h-5" />
                  </button>
                  <div className="flex-1 text-center font-semibold text-stone-800">
                    {threadCount}
                  </div>
                  <button
                    type="button"
                    onClick={() => setThreadCount((prev) => {
                      const val = Math.min(loginMethod === "cookie" ? 3 : 5, prev + 1);
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_thread_count`, val.toString());
                      }
                      return val;
                    })}
                    disabled={isRunning || isConfigSaved || threadCount >= (loginMethod === "cookie" ? 3 : 5)}
                    className="p-3 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">Đường dẫn Chrome <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  placeholder="Chuột phải vào GG Chrome -> Properties -> Target"
                  value={chromePath}
                  onChange={(e) => handleChromePathChange(e.target.value)}
                  disabled={isRunning || isConfigSaved}
                  className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all disabled:opacity-50 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">Phương thức đăng nhập</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label className={`flex items-center gap-2 p-3 border rounded-xl transition flex-1 opacity-40 bg-stone-50 border-stone-200 cursor-not-allowed`}>
                    <input type="radio" name="loginMethod" value="account" checked={loginMethod === "account"} disabled={true} className="hidden" />
                    <Key className="w-5 h-5 text-stone-400" />
                    <span className="font-medium text-sm text-stone-400">Tài khoản Google (Bảo trì)</span>
                  </label>
                  <label className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer flex-1 transition ${loginMethod === "cookie" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-stone-200 hover:bg-stone-50"} ${isRunning || isConfigSaved ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input type="radio" name="loginMethod" value="cookie" checked={loginMethod === "cookie"} onChange={() => { 
                      setLoginMethod("cookie"); 
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_login_method`, "cookie");
                        if (threadCount > 3) {
                          setThreadCount(3);
                          localStorage.setItem(`veo3_${user.id}_thread_count`, "3");
                        }
                      }
                    }} disabled={isRunning || isConfigSaved} className="hidden" />
                    <FileText className="w-5 h-5" />
                    <span className="font-medium text-sm">Cookies</span>
                  </label>
                  <label className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer flex-1 transition ${loginMethod === "tool" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-stone-200 hover:bg-stone-50"} ${isRunning || isConfigSaved ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input type="radio" name="loginMethod" value="tool" checked={loginMethod === "tool"} onChange={() => { 
                      setLoginMethod("tool"); 
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_login_method`, "tool");
                      }
                    }} disabled={isRunning || isConfigSaved} className="hidden" />
                    <Server className="w-5 h-5" />
                    <span className="font-medium text-sm">Tài khoản tool</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">
                  {loginMethod === "account" ? "Thông tin đăng nhập" : loginMethod === "tool" ? "Tài khoản BAS" : "Cách nhập dữ liệu"}
                </label>
                {loginMethod === "cookie" && (
                  <div className="flex items-center gap-4 mb-3">
                    <label className={`flex items-center gap-2 ${isRunning || isConfigSaved ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                      <input type="radio" name="importMethod" value="text" checked={importMethod === "text"} onChange={() => setImportMethod("text")} disabled={isRunning || isConfigSaved} className="text-emerald-500 focus:ring-emerald-500" />
                      <span className="text-sm">Nhập văn bản</span>
                    </label>
                  </div>
                )}

                {loginMethod === "tool" ? (
                  <div className="space-y-3">
                    <input
                      type="text"
                      placeholder="Tài khoản tools BAS"
                      value={toolAccount}
                      onChange={(e) => handleToolAccountChange(e.target.value)}
                      disabled={isRunning || isConfigSaved}
                      className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all disabled:opacity-50 text-sm font-mono"
                    />
                  </div>
                ) : importMethod === "text" ? (
                  loginMethod === "account" ? (
                    <div className="space-y-3">
                      <input
                        type="email"
                        placeholder="Tài khoản (Email)"
                        value={accountData.email}
                        onChange={(e) => handleAccountChange("email", e.target.value)}
                        disabled={isRunning || isConfigSaved}
                        className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all disabled:opacity-50 text-sm"
                      />
                      <input
                        type="password"
                        placeholder="Mật khẩu"
                        value={accountData.password}
                        onChange={(e) => handleAccountChange("password", e.target.value)}
                        disabled={isRunning || isConfigSaved}
                        className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all disabled:opacity-50 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Mã 2FA"
                        value={accountData.twoFA}
                        onChange={(e) => handleAccountChange("twoFA", e.target.value)}
                        disabled={isRunning || isConfigSaved}
                        className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all disabled:opacity-50 text-sm font-mono"
                      />
                    </div>
                  ) : (
                    <textarea
                      placeholder="Import Cookies from Text"
                      value={cookieData}
                      onChange={(e) => handleCookieChange(e.target.value)}
                      disabled={isRunning || isConfigSaved}
                      className="w-full h-32 px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all resize-none disabled:opacity-50 text-sm font-mono"
                    ></textarea>
                  )
                ) : (
                  <div className="w-full border-2 border-dashed border-stone-200 rounded-xl p-6 flex flex-col items-center justify-center bg-stone-50 hover:bg-stone-100 transition cursor-pointer relative">
                    <input type="file" accept=".txt" onChange={handleFileChange} disabled={isRunning} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" />
                    <FileUp className="w-8 h-8 text-stone-400 mb-2" />
                    <span className="text-sm font-medium text-stone-600">Click hoặc kéo thả file vào đây</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Log Section */}
          <div className="lg:col-span-8 bg-stone-900 rounded-2xl shadow-xl flex flex-col overflow-hidden border border-stone-800 h-[600px]">
            <div className="bg-stone-950 px-4 py-3 border-b border-stone-800 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-bold text-stone-200">Theo dõi quá trình tại đây</span>
              </div>
              <button onClick={handleClearLogs} className="text-stone-400 hover:text-stone-200 p-1 transition" title="Xóa logs">
                <ListRestart className="w-4 h-4" />
              </button>
            </div>



            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-stone-300 space-y-2 custom-scrollbar">
              {logs.length === 0 ? (
                <div className="text-stone-600 italic h-full flex items-center justify-center">Chưa có logs nào...</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="break-words">
                    {log.match(/^\[.*?\]/) ? (
                      <>
                        <span className="text-emerald-500 mr-2">{log.match(/^\[.*?\]/)?.[0]}</span>
                        {log.replace(/^\[.*?\]\s*/, '')}
                      </>
                    ) : (
                      <span>{log}</span>
                    )}
                  </div>
                ))
              )}

              {/* THÔNG MINH: Thanh tiến trình hiển thị CÙNG DÒNG VỚI LOG */}
              {Object.keys(jobProgress).length > 0 && (
                <div className="pt-2 pb-2 space-y-3">
                  {Object.entries(jobProgress).map(([jobId, percent]) => (
                    <div key={jobId} className="space-y-1.5">
                      <div className="flex items-center gap-3 font-mono text-xs text-stone-300">
                        <span className="text-emerald-500 font-bold whitespace-nowrap">[{percent}%]</span>
                        <span className="whitespace-nowrap">Tiến trình Job {jobId}:</span>
                        <div className="flex-1 max-w-md bg-stone-800 rounded-sm h-1.5 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full transition-all duration-500"
                            style={{ width: `${percent}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Veo3Section;
