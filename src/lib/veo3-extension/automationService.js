const fs = require('fs');
const path = require('path');
const AutomationWorker = require('./worker');

class GlobalAutomationState {
    constructor() {
        this.workers = [];
        this.worker = null;
        this.isRunning = false;
        this.logs = [];
        this.listeners = new Set();
    }

    addLog(msg) {
        if (!msg) return;
        const time = new Date().toLocaleTimeString();
        const logMsg = `[${time}] ${msg}`;
        this.logs.push(logMsg);
        if (this.logs.length > 1000) this.logs.shift();
        this.listeners.forEach(listener => listener(logMsg));
    }

    async stop() {
        if (this.isRunning) {
            this.addLog('[HỆ THỐNG] Đang dừng các trình duyệt, vui lòng đợi...');
            try {
                if (this.workers && this.workers.length > 0) {
                    await Promise.all(this.workers.map(w => w.close().catch(e=>{})));
                } else if (this.worker) {
                    await this.worker.close().catch(e=>{});
                }
            } catch (e) {}
            this.isRunning = false;
            this.workers = [];
            this.worker = null;
            this.addLog('[HỆ THỐNG] Tiến trình đã dừng theo yêu cầu.');
            this.listeners.forEach(listener => listener('[DONE]'));
            this.listeners.clear();
        }
    }
}

const globalState = new GlobalAutomationState();

async function startAutomation(config) {
    if (globalState.isRunning) {
        return { success: false, message: 'Automation is already running' };
    }

    globalState.logs = [];
    globalState.isRunning = true;
    globalState.listeners.clear();

    runBackground(config).catch(err => {
        globalState.addLog(`[LỖI NGHIÊM TRỌNG] ${err.message}`);
        globalState.addLog('[DONE]');
        globalState.isRunning = false;
    });

    return { success: true };
}

async function runBackground(config) {
    let OUTPUT_DIR = config.outputFolder && config.outputFolder.trim() ? config.outputFolder.trim() : 'C:\\';
    try {
        if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    } catch (err) {
        const os = require('os');
        OUTPUT_DIR = path.join(os.tmpdir(), 'harumi-outputs');
        if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        globalState.addLog(`⚠️ Cảnh báo: Lỗi đường dẫn (ENOTDIR/EPERM). Đã tự động chuyển nơi lưu video sang: ${OUTPUT_DIR}`);
    }
    const defaultProfilePath = 'Profiles_BAS_Flow'; // Chỉ để tên thư mục, worker.js sẽ tự nối với USER_DATA_PATH

    const headlessValue = config.isHeadless !== undefined ? config.isHeadless : false;

    const account = {
        id: 'account_veo3_local',
        email: config.accountData ? config.accountData.email : '',
        password: config.accountData ? config.accountData.password : '',
        twoFactorSecret: config.accountData ? config.accountData.twoFA : '',
        loginType: 'auto',
        headless: headlessValue,
        profilePath: defaultProfilePath,
        outputDir: OUTPUT_DIR,
        cookies: config.cookieData ? (typeof config.cookieData === 'string' ? JSON.parse(config.cookieData) : config.cookieData) : null,
        chromePath: config.chromePath,
        loginMethod: config.loginMethod,
        toolAccount: config.toolAccount
    };

    // Dummy AutomationService để bơm vào AutomationWorker (vì nó cần 1 số hàm cơ bản)
    const dummyService = {
        isRunning: () => globalState.isRunning,
        addLog: (id, msg) => {
            globalState.addLog(msg);
        },
        configManager: {
            getConfig: () => ({
                videoSettings: {
                    ratio: config.videoRatio || '16:9',
                    count: 1,
                    model: 'Veo 3.1 - Lite [Lower Priority]'
                }
            })
        },
        accountManager: {
            updateAccount: (id, data) => {}
        },
        db: {
            addLog: (jobId, dbId, type, msg) => {}
        }
    };

    globalState.addLog("=========================================");
    globalState.addLog("BẮT ĐẦU QUÁ TRÌNH TẠO VIDEO TỰ ĐỘNG");
    globalState.addLog("=========================================");

    if (config.loginMethod === 'tool') {
        if (!config.toolAccount) {
            throw new Error("LỖI: Chọn phương thức Tài khoản tool nhưng không cung cấp tên tài khoản BAS!");
        }
        globalState.addLog(`[API Tools] Đang kết nối lấy dữ liệu cho tài khoản Tools: ${config.toolAccount}...`);
        try {
            const basApiUrl = config.apiUrl;
            const res = await fetch(`${basApiUrl}/bas/check-account`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Bearer ${config.token}`
                },
                body: `username=${encodeURIComponent(config.toolAccount)}`
            });
            if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
            
            const data = await res.json();
            if (data.flowAccount && data.flowAccount.email && data.flowAccount.password) {
                globalState.addLog("✅ Đã lấy thành công tài khoản liên kết Flow!");
                account.email = data.flowAccount.email;
                account.password = data.flowAccount.password;
                account.twoFactorSecret = data.flowAccount.twoFaCode || '';
                
                
                account.cookies = null;
            } else {
                globalState.addLog("⚠️ Tài khoản tool của bạn chưa được liên kết với tài khoản VEO3.");
            }
        } catch (e) {
            throw new Error(`Không thể lấy thông tin từ API BAS: ${e.message}`);
        }
    }

    const dummyIo = { 
        emit: (event, data) => {
            if (event === 'log') {
                globalState.addLog(data);
            }
        } 
    };

    dummyService.workers = [];
    const threadCount = config.threadCount || 1;
    for (let i = 0; i < threadCount; i++) {
        const workerId = `worker_${i+1}`;
        const worker = new AutomationWorker(workerId, account, dummyService, dummyIo, null);
        dummyService.workers.push(worker);
    }
    globalState.workers = dummyService.workers;
    globalState.worker = dummyService.workers[0];

    globalState.addLog(`Đang nạp dữ liệu từ API...`);
    let pendingJobs = [];
    try {
        const backendUrl = config.apiUrl;
        let jobs = [];
        let currentPage = 1;
        let hasMore = true;
        const limit = 100;

        while (hasMore) {
            const res = await fetch(`${backendUrl}/flow/veo3?page=${currentPage}&limit=${limit}`, {
                headers: { 'Authorization': `Bearer ${config.token}` }
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

        await autoResetFailedJobs(config, jobs);

        pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'processing' || j.status === 'uploaded' || j.status === 1);
        globalState.addLog(`Phát hiện ${pendingJobs.length} jobs pending từ API.`);
    } catch (e) {
        globalState.addLog(`Lỗi gọi API lấy Jobs: ${e.message}`);
    }

    if (pendingJobs.length === 0) {
        globalState.addLog("🎉 [HỆ THỐNG] Không có Job nào cần xử lý!");
        globalState.addLog('[DONE]');
        globalState.isRunning = false;
        globalState.workers = [];
        globalState.worker = null;
        return;
    }

    globalState.addLog(`\n✅ Đã đẩy toàn bộ Job vào hàng đợi. Chuẩn bị khởi động trình duyệt...`);

    // Dọn dẹp Chrome cũ
    try {
        const { execSync } = require('child_process');
        for (const w of globalState.workers) {
            const profilePathStr = w.profilePath || path.join(userDataPath, account.profilePath, 'cloak_' + account.id);
            if (process.platform === 'win32') {
                const psCmd = `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe' OR Name='msedge.exe'\\" | Where-Object { $_.CommandLine -match '${profilePathStr.replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;
                execSync(psCmd, { stdio: 'ignore' });
            } else {
                execSync(`pkill -f "${profilePathStr}"`, { stdio: 'ignore' });
            }
            const lockFile = path.join(profilePathStr, 'SingletonLock');
            if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
        }
    } catch (e) {}


    try {
        await Promise.all(globalState.workers.map(w => w.launch().catch(e => {
            globalState.addLog(`Lỗi khởi động luồng ${w.id}: ${e.message}`);
        })));
    } catch (e) {
        throw new Error("Không thể khởi động trình duyệt. Lỗi: " + e.message);
    }

    const activeWorkers = globalState.workers.filter(w => w.browser);
    if (activeWorkers.length === 0) {
        throw new Error("Không thể khởi động trình duyệt tự động trên bất kỳ luồng nào. Vui lòng kiểm tra Task Manager.");
    }

    let jobIndex = 0;
    let isFetchingMore = false;

    async function fetchMoreJobs() {
        if (isFetchingMore) {
            while (isFetchingMore && globalState.isRunning) {
                await new Promise(r => setTimeout(r, 1000));
            }
            return pendingJobs.length - jobIndex;
        }
        isFetchingMore = true;
        try {
            const backendUrl = config.apiUrl;
            let jobs = [];
            let currentPage = 1;
            let hasMore = true;
            const limit = 100;
            while (hasMore) {
                const res = await fetch(`${backendUrl}/flow/veo3?page=${currentPage}&limit=${limit}`, {
                    headers: { 'Authorization': `Bearer ${config.token}` }
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
            await autoResetFailedJobs(config, jobs);
            const newPending = jobs.filter(j => (j.status === 'pending' || j.status === 'processing' || j.status === 'uploaded' || j.status === 1) && !pendingJobs.some(existing => existing.id === j.id));
            if (newPending.length > 0) {
                pendingJobs.push(...newPending);
                globalState.addLog(`Phát hiện thêm ${newPending.length} jobs pending mới từ API.`);
            }
            return newPending.length;
        } catch (e) {
            return 0;
        } finally {
            isFetchingMore = false;
        }
    }

    async function processWorker(worker) {
        while (globalState.isRunning) {
            if (jobIndex >= pendingJobs.length) {
                globalState.addLog(`Đang kiểm tra thêm job mới từ API...`);
                const newJobsCount = await fetchMoreJobs();
                if (newJobsCount <= 0 && jobIndex >= pendingJobs.length) {
                    break;
                }
            }
            if (jobIndex >= pendingJobs.length) continue;
            
            const currentIndex = jobIndex++;
            const row = pendingJobs[currentIndex];
            globalState.addLog(`\n>>> Bắt đầu xử lý Job ${currentIndex+1}/${pendingJobs.length} (ID: ${row.id}) trên luồng ${worker.id.replace('worker_', '')} <<<`);
            
            let extractedImages = [];
            if (row.images && Array.isArray(row.images)) {
                for (let imgObj of row.images) {
                    if (typeof imgObj === 'string') {
                         extractedImages.push(imgObj);
                    } else if (typeof imgObj === 'object' && imgObj !== null) {
                         if (imgObj.Image1) extractedImages.push(imgObj.Image1);
                         if (imgObj.Image2) extractedImages.push(imgObj.Image2);
                         if (imgObj.image) extractedImages.push(imgObj.image);
                    }
                }
            }

            const hasImage = extractedImages.length > 0 || (row.images && Array.isArray(row.images) && row.images.length > 0) || row.image1;
            const isI2V = hasImage || (row.typeI2V === 'Ingredients to Video') || (row.videoType === 'Ingredients to Video');

            const jobData = {
                JOB_ID: row.id,
                PROMPT: row.prompt || '',
                TYPE_VIDEO: isI2V ? 'IN2V' : 'T2V',
                IMAGE_PATH: extractedImages.length > 0 ? extractedImages[0] : (row.images && row.images.length > 0 ? row.images[0] : (row.image1 || null)),
                IMAGE_PATH_2: extractedImages.length > 1 ? extractedImages[1] : (row.images && row.images.length > 1 ? row.images[1] : (row.image2 || null)),
                PROJECT_ID: row.projectId || 'api_jobs',
                PROJECT_NAME: row.projectName || row.project?.name || row.projectId || 'api_jobs',
                settings: {
                    videoQuality: config.videoQuality || '1080p',
                    videoSettings: {
                        ratio: config.videoRatio || '16:9',
                        count: 1,
                        model: 'Veo 3.1 - Lite [Lower Priority]'
                    }
                }
            };

            try {
                await updateApiStatus(config, row.id, 'processing');

                // Chạy Core Worker
                const result = await worker._internalProcessJob(jobData, OUTPUT_DIR);

                if (result && result.success && result.file) {
                    globalState.addLog(`✅ Job ${row.id} thành công! Tên file tải về: ${result.file}`);
                    await updateApiStatus(config, row.id, 'Completed');
                } else {
                    globalState.addLog(`❌ Job ${row.id} thất bại. Lý do: ${result.reason || 'Không rõ'}`);
                    await updateApiStatus(config, row.id, 'Failed');
                    
                    if (result.fatal) {
                        globalState.addLog(`⚠️ Lỗi nghiêm trọng (Fatal). Đang khởi động lại trình duyệt cho luồng ${worker.id}...`);
                        await worker.close(true);
                        if (!globalState.isRunning) break;
                        await worker.launch();
                    }
                }
            } catch (err) {
                await updateApiStatus(config, row.id, 'Failed');
                try {
                    await worker.close(true);
                    if (!globalState.isRunning) break;
                    await worker.launch();
                } catch(e) {}
            }
        }
    }

    await Promise.all(activeWorkers.map(w => processWorker(w)));

    globalState.addLog(`\n🎉 [HỆ THỐNG] Đã chạy xong tất cả các Job trong hàng đợi!`);
    
    // Đóng trình duyệt sau khi xong
    try {
        await Promise.all(activeWorkers.map(w => w.close()));
    } catch(e) {}

    globalState.addLog('[DONE]');
    globalState.isRunning = false;
    globalState.workers = [];
    globalState.worker = null;
}

async function updateApiStatus(config, jobId, status) {
    try {
        const backendUrl = config.apiUrl;
        await fetch(`${backendUrl}/flow/veo3/${jobId}/status`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.token}`
            },
            body: JSON.stringify({ status: status })
        });
        const displayStatus = status.charAt(0).toUpperCase() + status.slice(1);
        globalState.addLog(`Đã cập nhật trạng thái ${displayStatus} cho Job ${jobId}`);
    } catch (e) {
        globalState.addLog(`[LỖI API] Không thể cập nhật trạng thái: ${e.message}`);
    }
}

module.exports = {
    globalState,
    startAutomation,
    stopAutomation: () => globalState.stop(),
    autoResetFailedJobs
};



async function autoResetFailedJobs(config, fetchedJobs = null) {
    let resetJobIds = [];
    if (!config || !config.apiUrl || !config.token) return resetJobIds;
    const backendUrl = config.apiUrl;
    let jobs = fetchedJobs;
    if (!jobs) {
        try {
            let currentPage = 1;
            let hasMore = true;
            const limit = 100;
            jobs = [];
            while (hasMore) {
                const res = await fetch(`${backendUrl}/flow/veo3?page=${currentPage}&limit=${limit}`, {
                    headers: { "Authorization": `Bearer ${config.token}` }
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
        } catch(e) { return resetJobIds; }
    }
    
    if (!jobs) return resetJobIds;
    
    const now = Date.now();
    const waitTime = 5 * 60 * 1000;
    for (const j of jobs) {
        const status = String(j.status).toLowerCase();
        if (status === "failed" || status === "error") {
            const updatedTime = new Date(j.updatedAt || j.updated_at || j.createdAt || j.created_at || now).getTime();
            if (now - updatedTime > waitTime) {
                globalState.addLog(`Tự động phục hồi Job ID ${j.id} (Failed > 5p) về trạng thái chờ...`);
                try {
                    await fetch(`${backendUrl}/flow/veo3/${j.id}/status`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.token}` },
                        body: JSON.stringify({ status: "pending" })
                    });
                    j.status = "pending";
                    resetJobIds.push(j.id);
                } catch (err) {}
            }
        }
    }
    return resetJobIds;
}
