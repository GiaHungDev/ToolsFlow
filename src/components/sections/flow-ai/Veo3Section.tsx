"use client";

import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, Server, FileText, MonitorPlay, Key, FileUp, ListRestart, Minus, Plus, Settings, Save, Info } from "lucide-react";
import { Notify } from "@/lib/Notify";
import { useAppSelector } from "@/lib/redux/store";

const Veo3Section = () => {
  const { user } = useAppSelector((state) => state.auth);
  const [threadCount, setThreadCount] = useState<number>(1);
  const [videoQuality, setVideoQuality] = useState<"1080p" | "720p">("1080p");
  const [loginMethod, setLoginMethod] = useState<"account" | "cookie" | "tool">("account");
  const [importMethod, setImportMethod] = useState<"text" | "file">("text");
  const [accountData, setAccountData] = useState({ email: "", password: "", twoFA: "" });
  const [cookieData, setCookieData] = useState("");
  const [toolAccount, setToolAccount] = useState("");
  const [chromePath, setChromePath] = useState("");
  const [outputFolder, setOutputFolder] = useState("");
  
  const [isConfigSaved, _setIsConfigSaved] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("veo3_config_saved") === "true";
    }
    return false;
  });

  const setIsConfigSaved = (val: boolean) => {
    _setIsConfigSaved(val);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("veo3_config_saved", String(val));
    }
  };

  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [jobProgress, setJobProgress] = useState<Record<string, number>>({});
  const logEndRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<any>(null);

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
    } else {
      setChromePath("");
    }

    const savedToolAccount = localStorage.getItem(`veo3_${userId}_tool_account`);
    setToolAccount(savedToolAccount || "");

    const savedOutputFolder = localStorage.getItem(`veo3_${userId}_output_folder`);
    setOutputFolder(savedOutputFolder || "");

    const savedLoginMethod = localStorage.getItem(`veo3_${userId}_login_method`) as "account" | "cookie" | "tool";
    if (savedLoginMethod) {
      setLoginMethod(savedLoginMethod === "cookie" ? "account" : savedLoginMethod);
    } else {
      setLoginMethod("account");
    }

    const savedThreadCount = localStorage.getItem(`veo3_${userId}_thread_count`);
    if (savedThreadCount) {
      setThreadCount(Number(savedThreadCount));
    } else {
      setThreadCount(1);
    }

    const savedVideoQuality = localStorage.getItem(`veo3_${userId}_video_quality`) as "1080p" | "720p";
    if (savedVideoQuality) {
      setVideoQuality(savedVideoQuality);
    } else {
      setVideoQuality("1080p");
    }

    setConfig({
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
      token: typeof window !== "undefined" ? (localStorage.getItem("access_token") || localStorage.getItem("token")) : null
    });
  }, [user?.id]);

  // Tự động kiểm tra trạng thái chạy ngầm khi tải trang
  useEffect(() => {
    const checkRunningStatus = async () => {
      try {
        const response = await fetch('http://localhost:52424/api/veo3/start', {
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
      } catch (e) { }
    };
    setTimeout(checkRunningStatus, 300);
  }, []);

  // Background watcher: auto reset failed jobs every minute
  useEffect(() => {
    if (!config || !config.apiUrl || !config.token) return;

    const autoResetFailedJobs = async (cfg: any) => {
      let resetJobIds: string[] = [];
      const backendUrl = cfg.apiUrl;
      let jobs: any[] = [];
      try {
        let currentPage = 1;
        let hasMore = true;
        const limit = 100;
        while (hasMore) {
          const res = await fetch(`${backendUrl}/flow/veo3?page=${currentPage}&limit=${limit}`, {
            headers: { "Authorization": `Bearer ${cfg.token}` }
          });
          const data = await res.json();
          let pageJobs = Array.isArray(data) ? data : (data.data && Array.isArray(data.data) ? data.data : (data.data?.data && Array.isArray(data.data.data) ? data.data.data : []));
          if (pageJobs.length > 0) {
            jobs = jobs.concat(pageJobs);
            currentPage++;
            if (pageJobs.length < limit) hasMore = false;
          } else {
            hasMore = false;
          }
        }
      } catch (e) { return resetJobIds; }

      const now = Date.now();
      const waitTime = 5 * 60 * 1000;
      for (const j of jobs) {
        const status = String(j.status).toLowerCase();
        if (status === "failed" || status === "error") {
          const updatedTime = new Date(j.updatedAt || j.updated_at || j.createdAt || j.created_at || now).getTime();
          if (now - updatedTime > waitTime) {
            try {
              const res = await fetch(`${backendUrl}/flow/veo3/${j.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cfg.token}` },
                body: JSON.stringify({ status: "pending" })
              });
              if (res.ok) {
                resetJobIds.push(j.id);
              }
            } catch (err) {}
          }
        }
      }
      return resetJobIds;
    };

    const interval = setInterval(() => {
      autoResetFailedJobs(config).then((resetJobIds) => {
        if (resetJobIds && resetJobIds.length > 0) {
          resetJobIds.forEach(id => {
            Notify({
              title: "Tự động phục hồi",
              description: `Job ${id} đã được tạo lại do lỗi quá 5 phút.`,
              status: "success"
            });
            // Also append to logs
            setLogs(prev => [...prev, `✅ Job ID ${id} đã trở về trạng thái pending...`]);
          });
        }
      }).catch(err => console.log("Lỗi auto reset", err));
    }, 60000);
    return () => clearInterval(interval);
  }, [config]);

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

  const handleOutputFolderChange = (value: string) => {
    const cleanValue = value.replace(/["']/g, '');
    setOutputFolder(cleanValue);
    if (user?.id) {
      localStorage.setItem(`veo3_${user.id}_output_folder`, cleanValue);
    }
  };

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const executeSaveConfig = () => {
    if (loginMethod === "account" && importMethod === "text" && (!accountData.email || !accountData.password)) {
      Notify({ title: "Thiếu thông tin", description: "Vui lòng nhập đầy đủ Email và Mật khẩu!", status: "warning" });
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

  const handleSaveConfig = async () => {
    if (outputFolder.trim()) {
      const folderPath = outputFolder.trim();
      const isFileRegex = /\.[a-zA-Z0-9]+$/;
      if (isFileRegex.test(folderPath)) {
        Notify({ title: "Đường dẫn không hợp lệ", description: "Vui lòng nhập đường dẫn thư mục, không phải tập tin!", status: "warning" });
        return;
      }

      try {
        const checkRes = await fetch("http://localhost:52424/api/check-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: folderPath })
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (!checkData.exists) {
            Notify({
              title: "Thư mục không tồn tại",
              description: "Vui lòng kiểm tra lại đường dẫn thư mục lưu trữ!",
              status: "warning"
            });
            return;
          }
        }
      } catch (e) {
        // API failed, proceed as normal
      }
    }

    executeSaveConfig();
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
      const response = await fetch('http://localhost:52424/api/veo3/start', {
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
          outputFolder: outputFolder?.trim() ? outputFolder.trim() : "C:\\",
          userId: user?.id,
          username: user?.username,
          isHeadless: [1, '1', true].includes(user?.isHeadless as any),
          apiUrl: process.env.NEXT_PUBLIC_API_URL,
          isReconnecting,
          videoQuality,
        }),
      });

      const resData = await response.json();
      if (!response.ok || !resData.success) {
        addLog(`[LỖI] Không thể khởi động tiến trình: ${resData.error || resData.message || 'Lỗi không xác định'}`);
        setIsRunning(false);
        return;
      }

      // Nếu khởi chạy mới hoàn toàn thì clear logs cũ
      if (!isReconnecting) {
        setLogs([]);
      }

      // Mở luồng SSE bằng EventSource (đảm bảo luôn live stream mượt mà)
      const eventSource = new EventSource('http://localhost:52424/api/veo3/logs');

      eventSource.onmessage = (event) => {
        if (event.data === "[DONE]") {
          setIsRunning(false);
          eventSource.close();
          return;
        }

        try {
          const dataObj = JSON.parse(event.data);
          if (dataObj.log) {
            const logText = dataObj.log;
            
            // Lọc những log rác không có giá trị
            if (logText.includes("Ignoring extra certs") || logText.includes("PEM routines::ASN1 lib")) return;
            if (logText.includes("[Master][Account") && logText.endsWith("Pipeline")) return;
            if (logText.replace(/^\[.*?\]\s*/, '').trim() === '') return; 
            if (logText.includes("Đang kiểm tra tiến độ Job")) return; 
            if (logText.includes("chuyển sang: Rendering")) return; 

            const progressMatch = logText.match(/Tiến trình Job (.*?):\s*(\d+)%/);
            if (progressMatch) {
              const jobId = progressMatch[1];
              const percent = parseInt(progressMatch[2], 10);
              setJobProgress((prev) => ({ ...prev, [jobId]: percent }));
              return; 
            }

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
              return;
            }

            setLogs((prev) => [...prev, logText]);
          }
        } catch (e) {
          // Bỏ qua lỗi parse JSON
        }
      };

      eventSource.onerror = () => {
        // addLog(`[LỖI] Luồng stream log bị ngắt kết nối.`);
        eventSource.close();
        setIsRunning(false);
      };

    } catch (error: any) {
      addLog(`[LỖI] Lỗi kết nối Server: ${error.message}`);
      setIsRunning(false);
    }
  };

  const handlePause = async () => {
    setIsRunning(false);
    addLog("Đang yêu cầu dừng tiến trình chạy ngầm...");
    try {
      await fetch('http://localhost:52424/api/veo3/start', {
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
    }
  };

  const renderLogContent = (text: string) => {
    const parts = text.split(/(Luồng \d+|worker_\d+)/g);
    return parts.map((part, i) => {
      if (part.match(/Luồng \d+|worker_\d+/)) {
        const numMatch = part.match(/\d+/);
        const num = numMatch ? parseInt(numMatch[0]) : 0;
        const colors = [
          "bg-blue-600 text-white",
          "bg-purple-600 text-white",
          "bg-pink-600 text-white",
          "bg-orange-600 text-white",
          "bg-yellow-600 text-black",
        ];
        const colorClass = colors[(num - 1) % colors.length] || "bg-stone-700 text-white";
        return <span key={i} className={`px-1.5 py-0.5 rounded font-bold mx-0.5 shadow-sm inline-block leading-none ${colorClass}`}>{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar">
      <div className="w-full max-w-[1500px] mx-auto p-4 md:px-8 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
              <MonitorPlay className="w-6 h-6 text-emerald-500" />
              Tạo video
            </h2>
            <p className="text-sm text-stone-500 mt-1">Cấu hình và chạy tự động trình duyệt để tạo video</p>
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
                      const val = Math.min(loginMethod === "account" ? 3 : 5, prev + 1);
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_thread_count`, val.toString());
                      }
                      return val;
                    })}
                    disabled={isRunning || isConfigSaved || threadCount >= (loginMethod === "account" ? 3 : 5)}
                    className="p-3 text-stone-500 hover:bg-stone-200 hover:text-stone-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">Chất lượng Video</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer flex-1 transition ${videoQuality === "1080p" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-stone-200 hover:bg-stone-50"} ${isRunning || isConfigSaved ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input type="radio" name="videoQuality" value="1080p" checked={videoQuality === "1080p"} onChange={() => {
                      setVideoQuality("1080p");
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_video_quality`, "1080p");
                      }
                    }} disabled={isRunning || isConfigSaved} className="hidden" />
                    <span className="font-medium text-sm">1080p</span>
                  </label>
                  <label className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer flex-1 transition ${videoQuality === "720p" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-stone-200 hover:bg-stone-50"} ${isRunning || isConfigSaved ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input type="radio" name="videoQuality" value="720p" checked={videoQuality === "720p"} onChange={() => {
                      setVideoQuality("720p");
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_video_quality`, "720p");
                      }
                    }} disabled={isRunning || isConfigSaved} className="hidden" />
                    <span className="font-medium text-sm">720p</span>
                  </label>
                </div>
                <div className="flex items-center gap-1.5 mt-2 text-stone-500 text-xs font-medium">
                  <Info className="w-4 h-4 text-emerald-500" />
                  <p>
                    {videoQuality === "1080p" 
                      ? "Chọn 1080p thì 1 video khoảng 2p15s" 
                      : "Chọn 720p thì 1 video khoảng 1p30s"}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">Phương thức đăng nhập</label>
                <div className="flex flex-col sm:flex-row gap-3">
                  <label className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer flex-1 transition ${loginMethod === "account" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-stone-200 hover:bg-stone-50"} ${isRunning || isConfigSaved ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input type="radio" name="loginMethod" value="account" checked={loginMethod === "account"} onChange={() => {
                      setLoginMethod("account");
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_login_method`, "account");
                        if (threadCount > 3) {
                          setThreadCount(3);
                          localStorage.setItem(`veo3_${user.id}_thread_count`, "3");
                        }
                      }
                    }} disabled={isRunning || isConfigSaved} className="hidden" />
                    <Key className="w-5 h-5" />
                    <span className="font-medium text-sm">Tài khoản GG</span>
                  </label>
                  <label className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer flex-1 transition ${loginMethod === "tool" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-stone-200 hover:bg-stone-50"} ${isRunning || isConfigSaved ? "opacity-50 cursor-not-allowed" : ""}`}>
                    <input type="radio" name="loginMethod" value="tool" checked={loginMethod === "tool"} onChange={() => {
                      setLoginMethod("tool");
                      if (user?.id) {
                        localStorage.setItem(`veo3_${user.id}_login_method`, "tool");
                      }
                    }} disabled={isRunning || isConfigSaved} className="hidden" />
                    <Server className="w-5 h-5" />
                    <span className="font-medium text-sm">Tài khoản Tools</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">
                  Lưu trữ Video tại 
                </label>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Vị trí bạn nhập + [ tên dự án ] \ video_[id]"
                    value={outputFolder}
                    onChange={(e) => handleOutputFolderChange(e.target.value)}
                    disabled={isRunning || isConfigSaved}
                    className="w-full px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 transition-all disabled:opacity-50 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-700 mb-2">
                  {loginMethod === "account" ? "Thông tin đăng nhập" : loginMethod === "tool" ? "Tài khoản Tools" : "Cách nhập dữ liệu"}
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
                      placeholder="Tài khoản Tools"
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
              <button 
                onClick={handleClearLogs} 
                className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs font-bold transition border border-stone-700 shadow-sm"
              >
                Clear
              </button>
            </div>



            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-stone-300 space-y-2 custom-scrollbar">
              {logs.length === 0 ? (
                <div className="text-stone-600 italic h-full flex items-center justify-center">Chưa có logs nào...</div>
              ) : (
                logs.map((log, idx) => (
                  <div key={idx} className="break-words leading-relaxed py-0.5">
                    {log.match(/^\[.*?\]/) ? (
                      <>
                        <span className="text-emerald-500 mr-2">{log.match(/^\[.*?\]/)?.[0]}</span>
                        {renderLogContent(log.replace(/^\[.*?\]\s*/, ''))}
                      </>
                    ) : (
                      renderLogContent(log)
                    )}
                  </div>
                ))
              )}

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
