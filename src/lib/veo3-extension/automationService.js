const fs = require('fs');
const path = require('path');
const AutomationWorker = require('./worker');
const BrowserPool = require('./browserPool');
const cloakUpdater = require('./cloakbrowser-updater');
const { createVeo3LogFormatter } = require('./userLogs');

class GlobalAutomationState {
    constructor() {
        this.workers = [];
        this.worker = null;
        this.isRunning = false;
        this.isPaused = false;
        this.logs = [];
        this.formatUserLog = createVeo3LogFormatter();
        this.userLogsFormatted = true;
        this.listeners = new Set();
        this.browserPool = new BrowserPool(this._createDummyIo());
    }

    _createDummyIo() {
        return {
            emit: (event, data) => {
                if (event === 'log') {
                    this.addLog(data);
                } else if (event === 'startup-phase') {
                    if (data && data.message) this.addLog(`[Khởi động] ${data.message}`);
                }
            }
        };
    }

    addLog(msg) {
        if (!msg) return;
        const time = new Date().toLocaleTimeString();
        if (msg === '[DONE]') {
            this.listeners.forEach(listener => { try { listener('[DONE]'); } catch (e) {} });
            return;
        }
        const logMsg = this.formatUserLog(`[${time}] ${msg}`);
        if (!logMsg) return;
        console.log(logMsg);
        this.logs.push(logMsg);
        if (this.logs.length > 1000) this.logs.shift();
        this.listeners.forEach(listener => {
            try { listener(logMsg); } catch (e) {}
        });
    }

    async stop() {
        if (this._stopTask) return this._stopTask;
        if (this.isRunning || this._runTask || this.workers.length || this.worker) {
            this.isRunning = false;
            for (const worker of this.workers) worker.isKilled = true;
            if (this.worker) this.worker.isKilled = true;
            this._stopTask = this._finishStop();
            try { await this._stopTask; } finally { this._stopTask = null; }
        }
    }

    async _finishStop() {
            this.addLog('[HỆ THỐNG] Đang dừng các trình duyệt, vui lòng đợi...');
            try {
                if (this.workers && this.workers.length > 0) {
                    await Promise.all(this.workers.map(w => w.close().catch(e => {})));
                } else if (this.worker) {
                    await this.worker.close().catch(e => {});
                }
            } catch (e) {}
            // Drain startup/retry work before allowing another run.
            if (this._runTask) await this._runTask;
            // Close any context that finished launching while the first close ran.
            await Promise.all(this.workers.filter(w => w.browser || w.page).map(w => w.close().catch(() => {})));
            this.isRunning = false;
            this.workers = [];
            this.worker = null;
            this.addLog('[HỆ THỐNG] Tiến trình đã dừng theo yêu cầu.');
            this.listeners.forEach(listener => {
                try { listener('[DONE]'); } catch (e) {}
            });
            this.listeners.clear();
    }
}

const globalState = new GlobalAutomationState();

async function startAutomation(config) {
    if (globalState.isRunning || globalState._runTask || globalState._stopTask) {
        return { success: false, message: 'Automation is already running' };
    }

    globalState.logs = [];
    globalState.formatUserLog = createVeo3LogFormatter();
    globalState.isRunning = true;
    globalState.listeners.clear();

    globalState._runTask = runBackground(config).catch(err => {
        if (!globalState.isRunning) return;
        globalState.addLog(`[LỖI NGHIÊM TRỌNG] ${err.message}`);
        globalState.addLog('[DONE]');
        globalState.isRunning = false;
    }).finally(() => { globalState._runTask = null; });

    return { success: true };
}

async function runBackground(config) {
    const baseUserDataDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
    if (!fs.existsSync(baseUserDataDir)) {
        fs.mkdirSync(baseUserDataDir, { recursive: true });
    }

    const { defaultDirectory, prepareOutputDirectory } = require('./downloadStorage');
    const OUTPUT_DIR = config.outputFolder?.trim() || '';
    if (OUTPUT_DIR) globalState.addLog(`Thư mục lưu video: ${OUTPUT_DIR}`);

    const defaultProfilePath = 'Profiles_BAS_Flow';
    const headlessValue = config.isHeadless !== undefined ? config.isHeadless : false;

    const baseAccount = {
        id: config.userId ? `user_${config.userId}` : 'account_veo3_local',
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

    const dummyIo = globalState._createDummyIo();

    // Đối tượng AutomationService cung cấp đầy đủ API cho AutomationWorker
    const automationService = {
        handlesCreditExhaustion: true,
        io: dummyIo,
        workers: [],
        get isRunning() { return globalState.isRunning; },
        get isPaused() { return globalState.isPaused; },
        addLog: (id, msg) => {
            globalState.addLog(msg);
        },
        log: (msg) => {
            globalState.addLog(msg);
        },
        browserPool: globalState.browserPool,
        configManager: {
            getConfig: () => ({
                workerCount: config.threadCount || 1,
                headless: headlessValue,
                visibility: headlessValue ? 'hidden' : 'visible',
                videoSettings: {
                    ratio: config.videoRatio || '16:9',
                    count: 1,
                    quality: config.videoQuality || '1080p',
                    model: config.videoModel || 'Veo 3.1 - Lite'
                }
            })
        },
        accountManager: {
            getAccountById: (id) => baseAccount,
            updateAccount: (id, data) => {
                Object.assign(baseAccount, data);
            }
        },
        db: {
            addLog: (jobId, dbId, type, msg) => {
                globalState.addLog(`[Job ${jobId}] ${msg}`);
            }
        },
        async restartWorker(id) {
            if (!globalState.isRunning) return;
            const worker = automationService.workers.find(w => w.id === id);
            if (worker) {
                if (worker._isRestarting || worker.isLaunching || worker._launching) {
                    globalState.addLog(`Luồng ${id} đang trong quá trình khởi động lại...`);
                    return { success: true };
                }
                worker._isRestarting = true;
                globalState.addLog(`Đang khởi động lại Luồng ${id}...`);
                try { await worker.close(); } catch (e) {}
                if (!globalState.isRunning) return;

                // Keep the same instance referenced by the queue and global state.
                worker.isBusy = false;
                worker.jobStartedAt = null;
                worker.currentJobId = null;
                worker.isLaunching = true;
                worker._launchedAt = Date.now();

                try {
                    await worker.launch();
                } finally {
                    worker.isLaunching = false;
                    worker._launching = false;
                    worker._isRestarting = false;
                }

                if (worker.page && worker.browser) {
                    worker.isOffline = false;
                    globalState.addLog(`Luồng ${id} đã khởi động lại thành công.`);
                } else {
                    worker.isOffline = true;
                    globalState.addLog(`⚠️ Luồng ${id} khởi động lại thất bại. Đã chuyển sang trạng thái offline.`);
                }
            }
        }
    };

    globalState.addLog("=========================================");
    globalState.addLog("BẮT ĐẦU QUÁ TRÌNH TẠO VIDEO TỰ ĐỘNG (VEO 3)");
    globalState.addLog("=========================================");

    // Kiểm tra và cập nhật CloakBrowser nếu cần
    try {
        globalState.addLog('[CloakBrowser] Kiểm tra cập nhật CloakBrowser...');
        const updateResult = await cloakUpdater.checkAndUpdate(dummyIo);
        if (updateResult && updateResult.message) {
            globalState.addLog(`[CloakBrowser] ${updateResult.message}`);
        }
    } catch (e) {
        globalState.addLog(`[CloakBrowser] Kiểm tra cập nhật bỏ qua: ${e.message}`);
    }

    if (!globalState.isRunning) return;
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
                baseAccount.email = data.flowAccount.email;
                baseAccount.password = data.flowAccount.password;
                baseAccount.twoFactorSecret = data.flowAccount.twoFaCode || '';
                baseAccount.cookies = null;
            } else {
                globalState.addLog("⚠️ Tài khoản tool của bạn chưa được liên kết với tài khoản VEO3.");
            }
        } catch (e) {
            throw new Error(`Không thể lấy thông tin từ API BAS: ${e.message}`);
        }
    }

    if (!globalState.isRunning) return;
    // Khởi tạo các Workers (xoá require cache để luôn nạp code mới nhất từ disk)
    const threadCount = Math.max(1, parseInt(config.threadCount) || 1);
    try {
        for (const modulePath of ['./worker', './flowUpload', './flowSettings', './flowGeneration', './downloadGate', './downloadStorage', './browserLaunch', './promptContent']) {
            delete require.cache[require.resolve(modulePath)];
        }
    } catch (e) {}
    const WorkerClass = require('./worker');
    automationService.workers = [];
    for (let i = 1; i <= threadCount; i++) {
        const workerAccount = {
            ...baseAccount,
            id: `${baseAccount.id}_thread_${i}`
        };
        const worker = new WorkerClass(i, workerAccount, automationService, dummyIo, null);
        automationService.workers.push(worker);
    }
    globalState.workers = automationService.workers;
    globalState.worker = automationService.workers[0];

    // Nạp Jobs từ API
    globalState.addLog(`Đang nạp danh sách Job từ API...`);
    let pendingJobs = [];
    try {
        const backendUrl = config.apiUrl;
        let jobs = [];
        let currentPage = 1;
        let hasMore = true;
        const limit = 100;

        while (hasMore && globalState.isRunning) {
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

        if (!globalState.isRunning) return;
        await autoResetFailedJobs(config, jobs);

        pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'processing' || j.status === 'uploaded' || j.status === 1);
        globalState.addLog(`Phát hiện ${pendingJobs.length} jobs pending từ API.`);
    } catch (e) {
        globalState.addLog(`Lỗi gọi API lấy Jobs: ${e.message}`);
    }

    if (!globalState.isRunning) return;
    if (pendingJobs.length === 0) {
        globalState.addLog("🎉 [HỆ THỐNG] Không có Job nào cần xử lý!");
        globalState.addLog('[DONE]');
        globalState.isRunning = false;
        globalState.workers = [];
        globalState.worker = null;
        return;
    }

    globalState.addLog(`\n✅ Đã chuẩn bị ${pendingJobs.length} Job. Đang dọn dẹp và khởi động ${globalState.workers.length} trình duyệt...`);

    // Dọn dẹp profile locks cũ an toàn
    for (const w of globalState.workers) {
        if (w.profilePath) {
            BrowserPool.cleanStaleLocks(w.profilePath);
        }
    }

    // Launch tất cả các worker
    try {
        await Promise.all(globalState.workers.map(w => w.launch().catch(e => {
            globalState.addLog(`Lỗi khởi động luồng ${w.id}: ${e.message}`);
        })));
    } catch (e) {
        throw new Error("Không thể khởi động trình duyệt. Lỗi: " + e.message);
    }

    if (!globalState.isRunning) {
        await Promise.all(globalState.workers.map(w => w.close().catch(() => {})));
        return;
    }
    const activeWorkers = globalState.workers.filter(w => w.browser && w.page);
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
            if (!globalState.isRunning) break;
            if (jobIndex >= pendingJobs.length) continue;
            
            const currentIndex = jobIndex++;
            const row = pendingJobs[currentIndex];
            if (!row) continue;

            globalState.addLog(`\n>>> Bắt đầu xử lý Job ${currentIndex + 1}/${pendingJobs.length} (ID: ${row.id}) trên luồng ${worker.id} <<<`);
            
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
                        model: config.videoModel || 'Veo 3.1 - Lite'
                    }
                }
            };

            try {
                await updateApiStatus(config, row.id, 'processing');

                // Chạy Core Worker (9-step pipeline chuẩn từ worker.js)
                const jobOutputDir = await prepareOutputDirectory(
                    '', message => globalState.addLog(message), defaultDirectory(jobData.PROJECT_NAME, OUTPUT_DIR)
                );
                globalState.addLog(`Thư mục lưu video: ${jobOutputDir}`);
                const result = await worker._internalProcessJob(jobData, jobOutputDir);
                if (!globalState.isRunning) break;

                if (result && result.success && result.file) {
                    globalState.addLog(`✅ Job ${row.id} thành công! Tên file tải về: ${result.file}`);
                    await updateApiStatus(config, row.id, 'Completed');
                } else {
                    const failReason = result?.reason || 'Không rõ';
                    globalState.addLog(`❌ Job ${row.id} thất bại. Lý do: ${failReason}`);
                    await updateApiStatus(config, row.id, 'Failed');
                    
                    if (result?.fatal) {
                        globalState.addLog(`⚠️ Gặp lỗi nghiêm trọng. Đang khởi động lại trình duyệt cho luồng ${worker.id}...`);
                        await automationService.restartWorker(worker.id);
                    }
                }
            } catch (err) {
                if (!globalState.isRunning) break;
                if (err.message?.includes('FLOW_CREDITS_EXHAUSTED')) {
                    globalState.addLog('HẾT CREDIT TẠO VIDEO! TỰ ĐỘNG TẠM DỪNG VÀ ĐÓNG TẤT CẢ TRÌNH DUYỆT. VUI LÒNG NẠP CREDIT TRƯỚC KHI CHẠY TIẾP.');
                    // stop() drains _runTask; never await it from inside that task.
                    const stopping = globalState.stop();
                    stopping.catch(error => globalState.addLog(`LỖI ĐÓNG TRÌNH DUYỆT: ${error.message}`.toUpperCase()));
                    await updateApiStatus(config, row.id, 'pending');
                    break;
                }
                globalState.addLog(`❌ Lỗi ngoại lệ tại Job ${row.id}: ${err.message}`);
                await updateApiStatus(config, row.id, 'Failed');
                if (err.message?.startsWith('FLOW_SETTINGS_SUMMARY_MISMATCH')) {
                    globalState.addLog(`[Job ${row.id}] Cấu hình hiển thị không khớp ban đầu. Bỏ qua job, giữ trình duyệt và không mở lại cài đặt.`);
                    continue;
                }
                if (err.message?.startsWith('PROMPT_ENTRY_VERIFY_FAILED')) {
                    globalState.addLog(`[Job ${row.id}] Không xác nhận được prompt. Giữ trình duyệt, bỏ qua job này; không gửi lệnh tạo video.`);
                    continue;
                }
                try {
                    await automationService.restartWorker(worker.id);
                } catch (e) {}
            }
        }
    }

    await Promise.all(activeWorkers.map(w => processWorker(w)));
    if (!globalState.isRunning) return;

    globalState.addLog(`\n🎉 [HỆ THỐNG] Đã hoàn tất tất cả các Job trong hàng đợi!`);
    
    // Đóng trình duyệt sau khi hoàn thành
    try {
        await Promise.all(activeWorkers.map(w => w.close()));
    } catch (e) {}

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
        } catch (e) { return resetJobIds; }
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

module.exports = {
    globalState,
    startAutomation,
    stopAutomation: () => globalState.stop(),
    autoResetFailedJobs
};
