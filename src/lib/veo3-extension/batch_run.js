const fs = require('fs');
const path = require('path');
const Veo3PipelineController = require('./Veo3PipelineController');

// Load .env manually if not already loaded by Next.js
try {
    const envPath = path.join(__dirname, '..', '..', '..', '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                const parts = trimmed.split('=');
                if (parts.length >= 2) {
                    const key = parts[0].trim();
                    const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                    if (!process.env[key]) {
                        process.env[key] = value;
                    }
                }
            }
        });
    }
} catch (e) {
    console.log(`[CẢNH BÁO ENV] Không thể nạp .env: ${e.message}`);
}

// Đọc cấu hình truyền vào từ CLI
const configStr = process.argv[2];
if (!configStr) {
    console.error("No config provided.");
    process.exit(1);
}
const config = JSON.parse(configStr);

const OUTPUT_DIR = path.join(__dirname, 'outputs');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const account = {
    id: 'account_veo3_local',
    email: config.accountData ? config.accountData.email : '',
    password: config.accountData ? config.accountData.password : '',
    twoFactorSecret: config.accountData ? config.accountData.twoFA : '',
    loginType: 'auto',
    headless: config.isHeadless !== undefined ? config.isHeadless : false,
    profilePath: 'C:\\Profiles_BAS_Flow',
    outputDir: OUTPUT_DIR,
    cookies: config.cookieData ? (typeof config.cookieData === 'string' ? JSON.parse(config.cookieData) : config.cookieData) : null,
    chromePath: config.chromePath,
    loginMethod: config.loginMethod,
    toolAccount: config.toolAccount
};

const masterService = {
    maxVideoThreads: config.threadCount || 1,
    maxImageThreads: 0,
    outputDir: OUTPUT_DIR,
    activeJobs: new Map(),

    log: (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        console.log(`[${time}] ${msg}`);
        // Log is captured by the parent Node process (Next.js) via stdout
    },

    updateJobStatus: async (job, status, error, finalPath, mediaUrl) => {
        console.log(`\n---> [TRẠNG THÁI] Job ${job.id} chuyển sang: ${status}`);
        if (finalPath) console.log(`---> [FILE ĐÃ TẢI]: ${finalPath}`);
        if (error) console.log(`---> [LỖI]: ${error}`);

        // Gọi API backend để cập nhật trạng thái
        if (status === 'Completed' || status === 'Failed') {
            try {
                const backendUrl = config.apiUrl;
                await fetch(`${backendUrl}/flow/veo3/${job.id}/status`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${config.token}`
                    },
                    body: JSON.stringify({
                        status: status
                    })
                });
                console.log(`[API] Đã cập nhật trạng thái ${status} lên server.`);
            } catch (e) {
                console.log(`[LỖI API] Không thể cập nhật trạng thái: ${e.message}`);
            }
        }
    }
};

async function startBatchProcess() {
    console.log("=========================================");
    console.log("=== BẮT ĐẦU VEO3 AUTOMATION ==============");
    console.log("=========================================\n");
    console.log(`=> Đã cấu hình chạy ${masterService.maxVideoThreads} luồng song song.`);

    // FETCH REMOTE ACCOUNT DATA IF LOGIN METHOD IS 'TOOL'
    if (config.loginMethod === 'tool') {
        if (!config.toolAccount) {
            console.log("❌ LỖI: Chọn phương thức Tài khoản tool nhưng không cung cấp tên tài khoản BAS!");
            process.exit(1);
        }
        console.log(`[API BAS] Đang kết nối lấy dữ liệu cho tài khoản BAS: ${config.toolAccount}...`);
        try {
            const basApiUrl = process.env.NEXT_PUBLIC_API_URL;
            const res = await fetch(`${basApiUrl}/bas/check-account`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Bearer ${config.token}`
                },
                body: `username=${encodeURIComponent(config.toolAccount)}`
            });
            if (!res.ok) {
                throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
            }
            const data = await res.json();
            if (data.flowAccount && data.flowAccount.email && data.flowAccount.password) {
                console.log("✅ Đã lấy thành công tài khoản liên kết Flow từ API BAS!");
                account.email = data.flowAccount.email;
                account.password = data.flowAccount.password;
                account.twoFactorSecret = data.flowAccount.twoFaCode || '';

                // Parse or assign cookies
                let cookies = null;
                if (data.flowAccount.cookies) {
                    if (typeof data.flowAccount.cookies === 'string') {
                        try {
                            cookies = JSON.parse(data.flowAccount.cookies);
                        } catch (e) {
                            console.log(`[CẢNH BÁO] Không thể parse cookies dạng string: ${e.message}`);
                        }
                    } else {
                        cookies = data.flowAccount.cookies;
                    }
                }
                account.cookies = cookies;
            } else {
                console.log("⚠️ Tài khoản tool của bạn chưa được liên kết với tài khoản VEO3.");
                account.email = '';
                account.password = '';
                account.twoFactorSecret = '';
                account.cookies = null;
            }
        } catch (e) {
            console.log(`❌ LỖI: Không thể lấy thông tin từ API BAS: ${e.message}`);
            process.exit(1);
        }
    }

    const controller = new Veo3PipelineController(account, masterService, null, 'edge', null);

    // Lấy job từ API TRƯỚC KHI KHỞI ĐỘNG TRÌNH DUYỆT
    console.log(`Đang nạp dữ liệu từ API...`);
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

            let pageJobs = [];
            if (Array.isArray(data)) pageJobs = data;
            else if (data.data && Array.isArray(data.data)) pageJobs = data.data;
            else if (data.data && data.data.data && Array.isArray(data.data.data)) pageJobs = data.data.data;

            if (pageJobs.length > 0) {
                jobs = jobs.concat(pageJobs);
                currentPage++;
                if (pageJobs.length < limit) {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        }

        const pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'processing' || j.status === 'uploaded' || j.status === 1);

        console.log(`Phát hiện ${pendingJobs.length} jobs pending từ API.`);

        for (let row of pendingJobs) {
            const job = {
                id: row.id,
                prompt: row.prompt || '',
                isImageTask: false,
                typeVideo: (row.images && Array.isArray(row.images) && row.images.length > 0) || (row.typeI2V === 'Ingredients to Video') || (row.videoType === 'Ingredients to Video') ? 'IN2V' : 'T2V',
                settings: {
                    videoSettings: {
                        ratio: '16:9',
                        count: 1,
                        model: 'Veo 3.1 - Lite [Lower Priority]'
                    }
                },
                images: row.images || [],
                image1: row.image1 || null,
                projectId: row.projectId || 'api_jobs',
                projectName: row.projectName || row.projectId || 'Veo3_Downloads',
                targetFileName: `video_${row.id}`
            };
            controller.addJob(job);
        }
    } catch (e) {
        console.log(`Lỗi gọi API lấy Jobs: ${e.message}`);
    }

    console.log(`\n✅ Đã đẩy toàn bộ Job vào hàng đợi (Pending Queue).`);

    // TỰ ĐỘNG DỌN DẸP ZOMBIE CHROME BỊ KẸT
    console.log(`[HỆ THỐNG] Đang kiểm tra và dọn dẹp các tiến trình Chrome bị kẹt từ lần chạy trước...`);
    try {
        const { execSync } = require('child_process');
        const profilePath = path.join(account.profilePath, 'edge_data');
        if (process.platform === 'win32') {
            // Dùng Powershell tìm và chỉ diệt những Chrome nào đang dùng thư mục edge_data này
            const psCmd = `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='chrome.exe' OR Name='msedge.exe'\\" | Where-Object { $_.CommandLine -match '${profilePath.replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;
            execSync(psCmd, { stdio: 'ignore' });
        } else {
            execSync(`pkill -f "${profilePath}"`, { stdio: 'ignore' });
        }
        
        // Xóa file lock nếu có
        const lockFile = path.join(profilePath, 'SingletonLock');
        if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    } catch (e) {
        // Bỏ qua lỗi nếu không tìm thấy tiến trình nào
    }

    // BÂY GIỜ MỚI KHỞI ĐỘNG BROWSER
    await controller.start();

    if (!controller.isRunning) {
        console.log("❌ LỖI NGHIÊM TRỌNG: Không thể khởi động trình duyệt tự động.");
        console.log("👉 LÝ DO: Có thể một tiến trình Chrome bị kẹt (chạy ngầm) đang khóa thư mục cấu hình (edge_data).");
        console.log("👉 CÁCH KHẮC PHỤC: Vui lòng mở Task Manager (Ctrl+Shift+Esc), tìm và 'End Task' tất cả các tiến trình 'Google Chrome' rồi chạy lại.");
        process.exit(1);
    }
}

startBatchProcess().catch(err => {
    console.error("Lỗi Crash hệ thống:", err);
});
