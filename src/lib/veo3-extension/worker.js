// CloakBrowser (Playwright) automation worker for Veo3 pipeline
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./encryption');
const OTPAuth = require('otpauth');

// Workers are fully isolated (separate browser processes, CDP-scoped input).
// No cross-worker mouse/keyboard conflicts — all workers run 100% parallel.

// Shared mutex: serialize cross-worker login (Google flags concurrent logins)
// and gallery search input (keyboard fill races between workers).
class SimpleMutex {
    constructor() { this._locked = false; this._queue = []; }
    acquire() {
        return new Promise(resolve => {
            if (!this._locked) { this._locked = true; resolve(); }
            else this._queue.push(resolve);
        });
    }
    release() {
        if (this._queue.length > 0) { this._queue.shift()(); }
        else this._locked = false;
    }
}
const globalLoginMutex = new SimpleMutex();
const globalUIMutex = new SimpleMutex();

const uploadLocks = new Map();
async function acquireUploadLock(key) {
    while (uploadLocks.has(key)) {
        await uploadLocks.get(key);
    }
    let resolveFn;
    const p = new Promise(resolve => { resolveFn = resolve; });
    p.resolve = resolveFn;
    uploadLocks.set(key, p);
    return () => {
        uploadLocks.delete(key);
        resolveFn();
    };
}

class AutomationWorker {
    constructor(id, accountData, automationService, io, assignedProxy = null) {
        this.id = id;
        this.accountData = accountData || {};
        this.automationService = automationService;
        this.io = io;
        this.browserType = 'cloak'; // CloakBrowser — profile suffix = cloak_{accountId} (unique per account for Windows AUMI)
        this.assignedProxy = assignedProxy;
        this.browser = null;
        this.page = null;
        this.isBusy = false;
        this.isOffline = false;

        this.startTime = Date.now();
        this.lastActionTime = Date.now();
        this.currentStep = 'Idle';
        this.isUploadingReference = false;
        this.consecutiveErrorCount = 0;
        this.unusualActivityStreak = 0; // Consecutive 'unusual activity' detections — triggers fingerprint rotation
        this.successfulGenerations = 0;
        this.needsProactiveReset = false;
        this.lastSuccessfulDownloadAt = Date.now(); // Track last successful download for 15-min restart trigger
        // Note: orchestrator is created and managed by automation.cjs, not by worker
        this._uploadedImages = new Set(); // Session-level tracking: resolved paths of already-uploaded images
        this.mousePos = { x: 100 + Math.floor(Math.random() * 400), y: 100 + Math.floor(Math.random() * 400) };

        // 1 worker = 1 unique profile directory (even when sharing the same account)
        const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
        const accountProfileName = this.accountData.profilePath || `profile_${id}`;

        const anchorAccountId = this.accountData.id || id;
        this.anchorProfilePath = path.join(baseDir, accountProfileName, `cloak_${anchorAccountId}`);

        // Chrome native profile: use isolated userDataDir per profile and do not copy
        if (this.accountData.chromeProfilePath) {
            this.chromeProfileName = this.accountData.chromeProfilePath; // e.g. "Profile 126"
            this.profilePath = path.join(baseDir, 'chrome_profiles', this.chromeProfileName.replace(/\s+/g, '_'));
            this.useNativeChromeProfile = true;
        } else {
            // Check if another worker in the same service already uses this account's profile.
            // If so, create a worker-specific variant to avoid userDataDir collisions.
            let isMultipleWorkers = false;
            if (this.automationService && this.automationService.workers) {
                const otherWorkers = this.automationService.workers.filter(w =>
                    w.accountData && w.accountData.id === this.accountData.id && w.id !== this.id
                );
                if (otherWorkers.length > 0) {
                    isMultipleWorkers = true;
                }
            }

            if (!isMultipleWorkers) {
                // Trường hợp 1 worker: Sử dụng trực tiếp profile đăng nhập thủ công (anchor) để giữ session hoàn hảo
                this.profilePath = this.anchorProfilePath;
            } else {
                // Trường hợp nhiều worker chạy song song: Sử dụng thư mục isolated riêng biệt tránh lock file
                this.profilePath = path.join(baseDir, `${accountProfileName}_w${id}`, `cloak_w${id}`);
            }
            this.useNativeChromeProfile = false;
        }
    }

    log(msg) {
        this.lastActionTime = Date.now();
        this.currentStep = msg.length > 50 ? msg.substring(0, 50) + '...' : msg;

        // --- Bộ lọc log siêu tinh gọn ---
        const jobId = this.currentJobId ? `Job_${this.currentJobId}` : '';
        const wId = this.id.replace('worker_', '');
        let vMsg = '';

        // 0. Khởi động / Đăng nhập
        if (msg.includes('Khởi động trình duyệt')) {
            vMsg = `Đang khởi động trình duyệt ...`;
        } else if (msg.includes('Navigating to Veo3 for login check')) {
            vMsg = `Đang kiểm tra đăng nhập hệ thống...`;
        }
        // 1. Bắt đầu xử lý Job
        else if (msg.includes('[Orchestrator] Starting 9-Step Pipeline')) {
            const match = msg.match(/Job (\d+)/);
            const jId = match ? `Job_${match[1]}` : jobId;
            vMsg = `${jId} đang được xử lý...`;
        }
        // 1.5. Cài đặt hoàn tất, chuẩn bị nhập prompt
        else if (msg.includes('[step8_started]')) {
            vMsg = `Cài đặt thông số hoàn tất, chuẩn bị tạo video...`;
        }
        // 2. Bắt đầu tạo video (sau khi gửi prompt)
        else if (msg.includes('Prompt đã được gửi thành công') || msg.includes('bắt đầu chờ render')) {
            vMsg = `${jobId} đang thực hiện tạo video...`;
        }
        // 3. Kiểm tra tiến độ render
        else if (msg.includes('Starting render progress tracking')) {
            vMsg = `Kiểm tra video render...`;
        }
        // 4. Báo cáo phần trăm %
        else if (msg.includes('Tile status: generating') && msg.includes('%')) {
            const match = msg.match(/(\d+)%/);
            if (match) vMsg = `Tiến trình ${jobId}: ${match[1]}%`;
        }
        // 5. Báo cáo thời gian chờ
        else if (msg.includes('Progress: waited')) {
            const match = msg.match(/waited (\d+)s/);
            if (match) {
                if (match[1] === '5' && this.io) {
                    this.io.emit('log', `Luồng ${wId} : ✅ video đang được chạy, bạn yên tâm chờ 1 lát nhé`);
                }
                vMsg = `Đã chờ ${match[1]}s...`;
            }
        }
        // 6. Hoàn tất render
        else if (msg.includes('✓ Render COMPLETE')) {
            vMsg = `Render hoàn tất, chuẩn bị tải về...`;
        }
        // 7. Bắt đầu tải
        else if (msg.includes('Starting download')) {
            vMsg = `Đang tải video về máy...`;
        }
        // 8. Tải xong
        else if (msg.includes('✓ Download complete')) {
            const match = msg.match(/complete: (.*)/);
            if (match) vMsg = `✓ Tải thành công: ${match[1]}`;
        }
        else if (msg.includes('Đang chờ lấy link tải...')) {
            vMsg = 'Đang chờ lấy link tải...';
        }
        else if (msg.includes('Chưa tìm thấy...')) {
            vMsg = 'Chưa tìm thấy...';
        }
        else if (msg.includes('Đã tìm thấy link tải!')) {
            vMsg = 'Đã tìm thấy link tải!';
        }
        else if (msg.includes('Login verification successful')) {
            vMsg = 'Đã đăng nhập thành công!';
        }
        else if (msg.includes('Initiating New Project setup')) {
            vMsg = 'Đang mở giao diện tạo Video...';
        }
        else if (msg.includes('pill_button scan ERROR')) {
            const match = msg.match(/ERROR: (.*)/);
            vMsg = `❌ Lỗi khi tìm nút Menu: ${match ? match[1] : 'Không rõ'}`;
        }
        // 9. Lỗi
        else if (msg.includes('Render/Download failed')) {
            // const match = msg.match(/Render\/Download failed: (.*)/);
            // vMsg = `❌ Lỗi xử lý: [STEP 9] : Tạo Video thất bại. Chi tiết: ${match ? match[1] : 'Không xác định'}`;
            vMsg = `❌ Lỗi xử lý : Tạo Video thất bại.`;
        }
        else if (msg.includes('Pipeline failed at some step') || msg.includes('Pipeline failed')) {
            const isRunning = this.automationService && (typeof this.automationService.isRunning === 'function' ? this.automationService.isRunning() : true);
            if (isRunning) {
                vMsg = `Hệ thống sẽ tạo lại video ngay . Bạn đừng lo lắng`;
            }
        }
        else if (msg.toLowerCase().includes('error')) {
            vMsg = `❌ Lỗi xử lý: ${msg}`;
        }

        // Nếu vMsg rỗng nghĩa là các log rác, ta bỏ qua không phát đi nữa (ẩn hoàn toàn)
        if (!vMsg) return;

        const message = `Luồng ${wId} : ${vMsg}`;
        if (this.io) {
            this.io.emit('log', message);
            const jobId = this.currentJobId;
            if (jobId) {
                this.io.emit('job:log', {
                    jobId: jobId,
                    level: 'info',
                    message: msg,
                    createdAt: new Date().toISOString()
                });
                if (this.automationService && this.automationService.db) {
                    try {
                        this.automationService.db.addLog(jobId, null, 'info', msg);
                    } catch (e) { }
                }
            }
        }
    }

    _getExtensionPaths() {
        const extDir = path.resolve(__dirname, '../../extensions');
        if (!fs.existsSync(extDir)) return [];
        try {
            return fs.readdirSync(extDir)
                .map(name => path.join(extDir, name))
                .filter(p => fs.statSync(p).isDirectory());
        } catch (e) {
            return [];
        }
    }


    async launch() {
        // Prevent concurrent launches — pre-warm and pipeline may call simultaneously
        if (this._launching) {
            this.log('Launch already in progress, waiting for completion...');
            while (this._launching) {
                await new Promise(r => setTimeout(r, 500));
            }
            return;
        }
        this._launching = true;

        try {
            // Automatic profile lock cleanup to prevent 'Opening in existing browser session' error
            try {
                const fs = require('fs');
                const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
                for (const file of lockFiles) {
                    const lockPath = path.join(this.profilePath, file);
                    if (fs.existsSync(lockPath)) {
                        fs.unlinkSync(lockPath);
                        this.log(`Cleared abandoned ${file} from profile to prevent launch crash.`);
                    }
                }
            } catch (e) {
                // Ignore lock deletion errors
            }

            // Skip if browser is still alive — MUST check BEFORE any cleanup
            if (this.page && this.browser) {
                try {
                    const testPages = this.browser.pages();
                    if (testPages.length > 0) {
                        this.log('Launch skipped: existing browser page is still alive.');
                        return;
                    }
                } catch (e) { /* context is dead, continue with launch */ }
            }

            // SAFETY: Force close any orphan browser before launching new one
            if (this.browser) {
                this.log('Closing orphan browser before re-launch...');
                await this.close();
            }

            // ALWAYS kill zombie processes holding this profile's lock file,
            // even if this.browser is null (crash left orphan process alive)
            if (this.profilePath) {
                try {
                    const { execSync } = require('child_process');
                    // Use PowerShell to find PIDs matching this profile path, then force-kill each
                    const escaped = this.profilePath.replace(/'/g, "''");
                    const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | Select-Object -ExpandProperty ProcessId`;
                    const pidOutput = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf-8', timeout: 8000 }).trim();
                    if (pidOutput) {
                        const pids = pidOutput.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
                        for (const pid of pids) {
                            try {
                                execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 3000 });
                                this.log(`Killed zombie browser PID ${pid} for profile ${this.profilePath}`);
                            } catch (e) { /* process may have already exited */ }
                        }
                        // Wait briefly for OS to release lock files
                        await new Promise(r => setTimeout(r, 500));
                    }
                } catch (e) { /* non-fatal: no matching processes */ }
                // Also remove stale lock files left by crashed Chromium
                const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
                for (const lf of lockFiles) {
                    const lockPath = require('path').join(this.profilePath, lf);
                    try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch (e) { }
                }
            }



            this.log(`Launching CloakBrowser for account ${this.accountData?.email || this.id}...`);

            if (!fs.existsSync(this.profilePath)) {
                fs.mkdirSync(this.profilePath, { recursive: true });
            }

            // Tự động đồng bộ hóa session từ anchor profile nếu chạy isolated (nhiều worker)
            if (this.profilePath !== this.anchorProfilePath && !this.useNativeChromeProfile) {
                await this.syncSessionFromAnchor();
            }

            // Pre-launch cleanup — skip for Chrome native profiles (don't touch user's real profile)
            const BrowserPool = require('./browserPool');
            if (!this.useNativeChromeProfile) {
                BrowserPool.removeUnsafeExtensions(this.profilePath, (msg) => this.log(msg));
                BrowserPool.injectPreferences(this.profilePath);
                // Deep-clean transient data (cache, storage, cookies) every launch
                // Ensures each browser session starts fresh — prevents memory bloat
                this.deepCleanProfile();
            }
            BrowserPool.cleanStaleLocks(this.profilePath);

            // Generate fingerprint seed — rotates when unusual activity streak triggers restart
            // Uses override seed if set by fingerprint rotation, otherwise stable seed from profile path
            let profileSeed;
            if (this._overrideFingerprintSeed) {
                profileSeed = this._overrideFingerprintSeed;
                this.log(`[Fingerprint] Using rotated seed: ${profileSeed}`);
                this._overrideFingerprintSeed = null; // consume once
            } else {
                const seedInput = `worker_${this.id}_account_${this.accountData?.id || 'default'}`;
                const profileHash = crypto.createHash('md5').update(seedInput).digest('hex');
                profileSeed = 10000 + (parseInt(profileHash.substring(0, 8), 16) % 90000);
            }

            // Visibility controls from ConfigManager
            const cfg = this.automationService && this.automationService.configManager ? this.automationService.configManager.getConfig() : {};
            const rawHeadless = this.accountData.headless;
            const isHeadless = rawHeadless !== undefined && rawHeadless !== null
                ? String(rawHeadless) !== "false" && rawHeadless !== 0 && rawHeadless !== false
                : true;
            // Off-screen mode: hide browser window by placing it outside visible screen area
            const isHidden = isHeadless; // If not headless, show the window!
            const windowPosition = isHidden ? '-3000,0' : '0,0';

            const extensions = this._getExtensionPaths();
            const hasExtensions = extensions && extensions.length > 0;
            if (hasExtensions) {
                this.log(`[Extensions] Detected Chrome Extensions: ${extensions.map(p => path.basename(p)).join(', ')}. Forcing headed mode (headless=false) so extensions can load.`);
            }

            // Build CloakBrowser launch options — single consolidated config
            // backend: 'patchright' suppresses CDP automation signals that cause 403 on Google APIs
            const launchOptions = {
                userDataDir: this.profilePath,
                headless: hasExtensions ? false : (isHeadless ? true : false),
                humanize: true,
                acceptDownloads: true,
                extension_paths: extensions,
                humanConfig: {
                    mistype_chance: 0.05,              // 5% typo rate with self-correction
                    typing_delay: 100,                 // slower typing (ms per character)
                    idle_between_actions: true,         // micro-movements between clicks
                    idle_between_duration: [0.3, 0.8],  // idle duration range (seconds)
                },
                // geoip: true will be set below if proxy is available
                viewport: { width: 1920, height: 900 }, // CloakBrowser humanize requires explicit viewport for Bézier mouse calculations
                contextOptions: {
                    acceptDownloads: true,
                },
                args: [
                    // Window args are irrelevant in headless mode, but harmless; still keep them for headed runs.
                    `--window-position=${windowPosition}`,
                    '--window-size=1920,900',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-infobars',
                    '--hide-crash-restore-bubble',
                    '--disable-session-crashed-bubble',
                    '--disable-features=InfiniteSessionRestore,IsolateOrigins,site-per-process,AutomationControlled,TrackingProtection3pcd,TrackingProtection,PrivacySandboxSettings4,RelatedWebsiteSets,msTrackingPrevention',
                    '--noerrdialogs',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    `--fingerprint=${profileSeed}`,
                    '--fingerprint-storage-quota=5000', // Appear as regular profile, not incognito
                    '--max-active-webgl-contexts=100',  // Prevent reCAPTCHA WebGL fingerprint exhaustion (default=16)
                ],
            };

            // Force load unpacked extensions via command-line arguments (bulletproof loading in Playwright/Chromium)
            if (hasExtensions) {
                const extensionPathsStr = extensions.join(',');
                launchOptions.args.push(`--disable-extensions-except=${extensionPathsStr}`);
                launchOptions.args.push(`--load-extension=${extensionPathsStr}`);
                this.log(`[Extensions] Injected command-line arguments: --load-extension=${extensionPathsStr}`);
            }

            // Chrome native profile: select specific profile subdirectory to ensure unique AUMI and prevent Windows taskbar grouping
            if (this.useNativeChromeProfile && this.chromeProfileName) {
                launchOptions.args.push(`--profile-directory=${this.chromeProfileName}`);
                this.log(`[Chrome Native] Using isolated profile with unique AUMI: ${this.chromeProfileName} at ${this.profilePath}`);
            }



            // Proxy config — CloakBrowser object format for auth safety
            // Object format avoids URL parsing issues when password contains : or @
            // --fingerprint-webrtc-ip=auto requires proxy (resolves exit IP via proxy)
            let proxyServer = null;
            let proxyUsername = null;
            let proxyPassword = null;

            if (this.assignedProxy) {
                // Support SOCKS5 protocol if specified, otherwise default to HTTP
                const proxyProtocol = this.assignedProxy.protocol || 'http';
                proxyServer = `${proxyProtocol}://${this.assignedProxy.ip}:${this.assignedProxy.port}`;
                proxyUsername = this.assignedProxy.username;
                proxyPassword = this.assignedProxy.password;
            } else if (this.accountData && this.accountData.proxy) {
                let p = this.accountData.proxy.trim();
                if (!p.includes('://')) {
                    const parts = p.split(':');
                    if (parts.length >= 5 && ['socks5', 'socks4', 'http', 'https'].includes(parts[0].toLowerCase())) {
                        // Format: protocol:ip:port:user:pass (5+ parts, first is protocol)
                        proxyServer = `${parts[0]}://${parts[1]}:${parts[2]}`;
                        proxyUsername = parts[3];
                        proxyPassword = parts.slice(4).join(':');
                    } else if (parts.length >= 4) {
                        proxyServer = `http://${parts[0]}:${parts[1]}`;
                        proxyUsername = parts[2];
                        // Join remaining parts to handle passwords containing ':'
                        proxyPassword = parts.slice(3).join(':');
                    } else if (parts.length === 2) {
                        proxyServer = `http://${parts[0]}:${parts[1]}`;
                    }
                } else {
                    // Full URL provided (e.g. http://user:pass@IP:PORT or socks5://IP:PORT)
                    try {
                        const url = new URL(p);
                        if (url.username) {
                            proxyUsername = decodeURIComponent(url.username);
                            proxyPassword = decodeURIComponent(url.password);
                            proxyServer = `${url.protocol}//${url.host}`;
                        } else {
                            proxyServer = p;
                        }
                    } catch (e) {
                        proxyServer = p;
                    }
                }
            }
            if (proxyServer) {
                launchOptions.args.push('--fingerprint-webrtc-ip=auto');
                launchOptions.geoip = true; // Auto-detect Timezone & Locale from Proxy

                if (proxyUsername && proxyPassword) {
                    // Use object format — Playwright/CloakBrowser handles auth internally
                    // Safe for passwords containing special characters (: @ # etc.)
                    launchOptions.proxy = {
                        server: proxyServer,
                        username: proxyUsername,
                        password: proxyPassword,
                    };
                } else {
                    launchOptions.proxy = proxyServer;
                }
                // Mask password in logs
                const maskedProxy = typeof launchOptions.proxy === 'object'
                    ? `${launchOptions.proxy.server} (auth: ${proxyUsername}:***)`
                    : launchOptions.proxy;
                this.log(`Configured Stealth Proxy: ${maskedProxy}`);
            } else {
                // No proxy: set timezone/locale from system to prevent timezone mismatch
                // Without this, CloakBrowser defaults to UTC which mismatches the real IP's timezone
                const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
                launchOptions.timezone = systemTimezone;
                launchOptions.locale = systemLocale;
                this.log(`[Timezone] No proxy — using system timezone: ${systemTimezone}, locale: ${systemLocale}`);
            }

            // Launch CloakBrowser (Playwright-based)
            try {
                const { launchPersistentContext } = await import('cloakbrowser');
                const context = await launchPersistentContext(launchOptions);

                this.browser = context;
                this._lastAppliedSettings = null;
                this.viewModeApplied = false;
                this.log(`CloakBrowser launched with fingerprint seed: ${profileSeed}`);

            } catch (firstErr) {
                this.log(`CloakBrowser launch failed (attempt 1): ${firstErr.message}. Cleaning up and retrying...`);
                BrowserPool.cleanStaleLocks(this.profilePath);
                await new Promise(r => setTimeout(r, 2000));

                try {
                    const { launchPersistentContext } = await import('cloakbrowser');
                    this.log('Retrying CloakBrowser launch (attempt 2)...');
                    const context = await launchPersistentContext(launchOptions);
                    this.browser = context;
                    this._lastAppliedSettings = null;
                    this.viewModeApplied = false;
                    this.log('CloakBrowser launched successfully on retry.');
                } catch (retryErr) {
                    this.log(`CloakBrowser retry also failed: ${retryErr.message}`);
                    this.isOffline = true;
                    this.io.emit('worker-status', { id: this.id, status: 'offline' });
                    throw new Error(`Browser launch failed after 2 attempts: ${retryErr.message}`);
                }
            }

            // Stub CDP detection functions that Google uses to detect automation
            // __chromium_devtools_metrics_reporter throws TypeError when called by Google's
            // anti-bot script in VM sandboxes — this causes immediate 403 on all API calls
            this.browser.addInitScript(() => {
                // Patch 1: CDP metrics reporter — Google checks this to detect Playwright/CDP control
                if (typeof window.__chromium_devtools_metrics_reporter !== 'function') {
                    Object.defineProperty(window, '__chromium_devtools_metrics_reporter', {
                        value: function () { /* no-op stub */ },
                        writable: false,
                        configurable: false,
                        enumerable: false
                    });
                }

                // Patch 2: Suppress zustand devtools middleware warning (Flow app is Next.js + zustand)
                // This prevents console noise and removes a detectable extension check
                if (!window.__REDUX_DEVTOOLS_EXTENSION__) {
                    window.__REDUX_DEVTOOLS_EXTENSION__ = { connect: () => ({ init: () => { }, send: () => { }, subscribe: () => () => { } }) };
                    window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = (f) => f;
                }
            });

            // Lifecycle: BrowserContext emits 'close' (not 'disconnected')
            this.browser.on('close', () => {
                this.io.emit('worker-status', { id: this.id, status: 'offline' });
                this.log('Browser closed. Worker offline.');
            });

            // 1c. Inject saved auth cookies to restore session (Soft Session Reset)
            if (this._savedAuthCookies && this._savedAuthCookies.length > 0) {
                try {
                    await this.browser.addCookies(this._savedAuthCookies);
                    this.log(`[Launch] Injected ${this._savedAuthCookies.length} saved auth cookies. Session restored!`);
                } catch (e) {
                    this.log(`[Launch] Failed to inject auth cookies: ${e.message}`);
                }
                this._savedAuthCookies = null; // Consume once
            }

            // Tận dụng tab đầu tiên làm tab giữ nền (about:blank) để tránh sập Context
            const pages = this.browser.pages();
            if (pages.length > 0) {
                this.blankPage = pages[0];
                await this.blankPage.goto('about:blank').catch(() => { });
                for (let i = 1; i < pages.length; i++) {
                    await pages[i].close().catch(() => { });
                }
            } else {
                this.blankPage = await this.browser.newPage();
                await this.blankPage.goto('about:blank').catch(() => { });
            }

            // Tạo tab thứ 2 dành riêng cho tác vụ Veo3 chính
            this.page = await this.browser.newPage();

            // Intercept flowMedia:batchGenerate API to optimize isDirectReuseRequest flag
            await this.page.route('**/flowMedia:batchGenerate', async (route) => {
                const req = route.request();
                if (req.method() === 'POST') {
                    try {
                        const postData = req.postDataJSON();
                        if (postData) {
                            this.log(`[Network Intercept] Intercepted batchGenerate API.`);
                            const currentUrl = this.page ? this.page.url() : '';
                            const inActiveProject = currentUrl.match(/\/flow\/project\/[^\/]+/);

                            const targetValue = !!inActiveProject;
                            this.log(`[Network Intercept] Processing batchGenerate payload. Target isDirectReuseRequest = ${targetValue}`);

                            // Recursive function to deeply modify any nested occurrences of isDirectReuseRequest and randomize activeSessionId / sessionId
                            const modifyPayload = (obj, reuseVal) => {
                                if (!obj || typeof obj !== 'object') return;
                                if (Array.isArray(obj)) {
                                    for (const item of obj) {
                                        modifyPayload(item, reuseVal);
                                    }
                                } else {
                                    // 1. Force isDirectReuseRequest flag
                                    if ('isDirectReuseRequest' in obj) {
                                        const oldVal = obj.isDirectReuseRequest;
                                        obj.isDirectReuseRequest = reuseVal;
                                        this.log(`[Network Intercept] Found isDirectReuseRequest: ${oldVal} => ${reuseVal}`);
                                    }

                                    // 2. Randomize activeSessionId / sessionId if present to ensure it changes continuously on every request
                                    for (const k in obj) {
                                        if (Object.prototype.hasOwnProperty.call(obj, k)) {
                                            const lowerK = k.toLowerCase();
                                            if (lowerK === 'activesessionid' || lowerK === 'sessionid' || lowerK === 'clientsessionid') {
                                                const oldSessionId = obj[k];
                                                if (typeof oldSessionId === 'string' && oldSessionId.length > 5) {
                                                    const freshSessionId = 's_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                                                    obj[k] = freshSessionId;
                                                    this.log(`[Network Intercept] Detected ${k}: forcing rotation to avoid 403 (${oldSessionId} => ${freshSessionId})`);
                                                }
                                            } else if (typeof obj[k] === 'object') {
                                                modifyPayload(obj[k], reuseVal);
                                            }
                                        }
                                    }
                                }
                            };

                            modifyPayload(postData, targetValue);

                            await route.continue({
                                postData: JSON.stringify(postData)
                            });
                            return;
                        }
                    } catch (e) {
                        this.log(`[Network Intercept] Failed to process batchGenerate JSON payload: ${e.message}`);
                    }
                }
                await route.continue();
            });

            // Tránh giựt focus nếu chạy ở chế độ nổi (headed)
            if (!isHeadless && !isHidden) {
                await this.page.bringToFront();
            }

            // Failsafe: Auto-close any NEW blank tabs that Chromium spawns
            this.browser.on('page', async (newPage) => {
                try {
                    await new Promise(r => setTimeout(r, 1000));
                    if (newPage === this.blankPage || newPage === this.page || newPage === this.reputationPage) return;
                    if (newPage.isClosed()) return;
                    const url = newPage.url();
                    if (url === 'about:blank' || url === 'chrome://newtab/' || url === 'chrome://new-tab-page/') {
                        this.log(`Auto-closing unwanted new tab: ${url}`);
                        await newPage.close().catch(() => { });
                    }
                } catch (e) { /* page already closed */ }
            });

            // CloakBrowser handles: User-Agent, sec-ch-ua, canvas/WebGL/hardware spoofing
            // via binary-level patches. No JS injection needed.
            // Proxy auth handled natively via launchOptions.proxy (username/password).
            this.page.on('dialog', async dialog => {
                await dialog.accept();
            });

            // Register with BrowserPool for lifecycle management
            if (this.automationService && this.automationService.browserPool) {
                this.automationService.browserPool.register(this.id, this.browser, this.profilePath);
            }

            this.log('Browser launched successfully');
            await this.handleLoginWait();

        } finally {
            this._launching = false;
        }
    }

    async checkAndRecoverSession() {
        if (!this.page) return false;
        try {
            let clicked = false;
            for (const frame of this.page.frames()) {
                clicked = await frame.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                    const spans = Array.from(document.querySelectorAll('span, div'));
                    const allEls = [...btns, ...spans];

                    for (const el of allEls) {
                        const t = (el.innerText || '').trim().toLowerCase();
                        if (t === 'sign in with google' || t === 'đăng nhập bằng google') {
                            const clickable = el.closest('button, [role="button"]') || el;
                            const r = clickable.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) {
                                return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                            }
                        }
                    }
                    return null;
                }).catch(() => null);

                if (clicked) {
                    await this.humanClick(this.page, clicked.x, clicked.y);
                    this.log('Detected Google Identity Session drop modal. Auto-clicking "Sign in with Google"...');
                    await this.sleep(2000 + Math.random() * 1000); // Give it time to process the login click
                    return true;
                }
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    /**
     * Full browser restart with new fingerprint.
     * Closes browser, deep-cleans profile, re-launches with fresh session.
     * Reusable by STEP 9c (unusual activity) and orchestrator (15-min no-download timeout).
     * @param {string} reason - Human-readable reason for logging
     */
    async performBrowserRestart(reason = 'unknown', clearCookies = false) {
        this.log(`[Restart] Starting full browser restart. Reason: ${reason}`);

        // 1. Keep the deterministic seed instead of generating a new random one
        // this._overrideFingerprintSeed = 10000 + Math.floor(Math.random() * 90000);
        // this.log(`[Restart] New fingerprint seed: ${this._overrideFingerprintSeed}`);

        // 1b. Extract and save core auth cookies to avoid re-login (Soft Session Reset)
        if (this.browser && !clearCookies) {
            try {
                const contexts = this.browser.contexts ? this.browser.contexts() : (this.browser.pages ? [this.browser] : []);
                const ctx = contexts.length > 0 ? contexts[0] : this.browser;
                if (ctx && typeof ctx.cookies === 'function') {
                    const allCookies = await ctx.cookies();
                    this._savedAuthCookies = allCookies.filter(c =>
                        ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'OSID'].includes(c.name) ||
                        c.name.startsWith('__Secure-')
                    );
                    this.log(`[Restart] Extracted ${this._savedAuthCookies.length} core auth cookies before close.`);
                }
            } catch (e) {
                this.log(`[Restart] Warning: Failed to extract cookies before close: ${e.message}`);
            }
        } else if (clearCookies) {
            this.log(`[Restart] Cookies marked for clear. Skipping cookie saving.`);
            this._savedAuthCookies = null;
        }

        // 2. Close browser completely (kills process, cleans locks)
        await this.close(true);

        // Đợi 1 giây để hệ điều hành nhả file lock trước khi xóa
        await this.sleep(1000);

        // 3. Deep-clean profile or nuke entire folder if clearCookies is true
        if (clearCookies && !this.useNativeChromeProfile) {
            this.log(`[Restart] Hard recovery triggered. Deleting entire root profile folder: ${this.profilePath}`);
            try {
                if (fs.existsSync(this.profilePath)) {
                    fs.rmSync(this.profilePath, { recursive: true, force: true });
                }
            } catch (rmErr) {
                this.log(`[Restart] Warning: Failed to delete root profile folder: ${rmErr.message}`);
            }
        } else {
            this.deepCleanProfile(!clearCookies);
        }

        // 4. Reset state
        this.isOffline = false;
        this.settingsApplied = false;
        this._lastAppliedSettings = null;
        this._uploadedImages.clear();

        // 5. Re-launch browser (new fingerprint) + login from scratch
        await this.launch();
        this.log(`[Restart] ✓ Browser restarted with new fingerprint. Reason: ${reason}`);
    }

    /**
     * Đồng bộ hóa session/cookie từ anchor profile (Manual Opener) sang worker profile.
     * Chỉ áp dụng khi có nhiều worker chạy song song (isolated profilePath).
     */
    async syncSessionFromAnchor() {
        this.log('[Session Sync] Đang đồng bộ hóa cookies/session từ Master Profile sang Worker Profile...');
        try {
            if (!fs.existsSync(this.anchorProfilePath)) {
                this.log('[Session Sync] Không tìm thấy Master Profile (anchorProfilePath) — Bỏ qua đồng bộ.');
                return;
            }

            const anchorDefault = path.join(this.anchorProfilePath, 'Default');
            const workerDefault = path.join(this.profilePath, 'Default');

            if (!fs.existsSync(anchorDefault)) {
                this.log('[Session Sync] Không tìm thấy thư mục Default trong Master Profile — Bỏ qua.');
                return;
            }

            if (!fs.existsSync(workerDefault)) {
                fs.mkdirSync(workerDefault, { recursive: true });
            }

            // 1. Sao chép file Local State
            const localStateSrc = path.join(this.anchorProfilePath, 'Local State');
            const localStateDest = path.join(this.profilePath, 'Local State');
            if (fs.existsSync(localStateSrc)) {
                fs.copyFileSync(localStateSrc, localStateDest);
            }

            // 2. Sao chép các thành phần lưu trữ session cốt lõi
            const itemsToSync = [
                { name: 'Network', isDir: true },
                { name: 'Local Storage', isDir: true },
                { name: 'Session Storage', isDir: true },
                { name: 'IndexedDB', isDir: true },
                { name: 'shared_proto_db', isDir: true },
                { name: 'Preferences', isDir: false },
                { name: 'Secure Preferences', isDir: false },
                { name: 'Login Data', isDir: false },
                { name: 'Web Data', isDir: false }
            ];

            for (const item of itemsToSync) {
                const srcPath = path.join(anchorDefault, item.name);
                const destPath = path.join(workerDefault, item.name);

                if (fs.existsSync(srcPath)) {
                    try {
                        if (item.isDir) {
                            if (typeof fs.cpSync === 'function') {
                                fs.cpSync(srcPath, destPath, { recursive: true, force: true, errorOnExist: false });
                            } else {
                                const copyRecursiveSync = (src, dest) => {
                                    const exists = fs.existsSync(src);
                                    const stats = exists && fs.statSync(src);
                                    const isDirectory = exists && stats.isDirectory();
                                    if (isDirectory) {
                                        if (!fs.exists(dest)) fs.mkdirSync(dest, { recursive: true });
                                        fs.readdirSync(src).forEach((childItemName) => {
                                            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
                                        });
                                    } else {
                                        try { fs.copyFileSync(src, dest); } catch (e) { }
                                    }
                                };
                                copyRecursiveSync(srcPath, destPath);
                            }
                        } else {
                            fs.copyFileSync(srcPath, destPath);
                        }
                    } catch (err) {
                        // Bỏ qua lỗi EACCES hoặc EBUSY do file đang bị khoá (ví dụ Network/Cookies)
                    }
                }
            }

            // 3. Nuke lock files trong worker directory vừa được copy sang
            const lockFiles = ['LOCK', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
            for (const file of lockFiles) {
                const lp = path.join(this.profilePath, file);
                const lpDefault = path.join(workerDefault, file);
                try { if (fs.existsSync(lp)) fs.unlinkSync(lp); } catch (e) { }
                try { if (fs.existsSync(lpDefault)) fs.unlinkSync(lpDefault); } catch (e) { }
            }

            this.log(`[Session Sync] ✓ Đồng bộ hóa session thành công (đã bỏ qua các file bị khoá).`);
        } catch (err) {
            this.log(`[Session Sync] Lỗi trong quá trình đồng bộ: ${err.message}`);
        }
    }

    /**
     * Safe evaluate wrapper: catches context destruction during navigation
     * and retries after waiting for the page to stabilize.
     */
    async safeEvaluate(page, fn, args, retries = 2) {
        for (let i = 0; i <= retries; i++) {
            try {
                return await page.evaluate(fn, args);
            } catch (e) {
                const msg = e.message || '';
                if (msg.includes('Execution context was destroyed') ||
                    msg.includes('navigation') ||
                    msg.includes('context destroyed')) {
                    if (i < retries) {
                        this.log(`[SafeEval] Context destroyed. Waiting 2s for navigation to settle (retry ${i + 1}/${retries})...`);
                        await this.sleep(2000);
                        // Wait for page to be in a stable state
                        try {
                            await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
                        } catch (_) { }
                        continue;
                    }
                }
                throw e;
            }
        }
    }

    async handleLoginWait() {
        if (!this.page) return;
        const targetPage = this.page;
        try {
            this.log('Navigating to Veo3 for login check...');
            await targetPage.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
                this.log(`Navigation noticed warning/redirect: ${err.message}`);
            });
            await this.sleep(1500 + Math.random() * 1000); // Give the app time to render

            const checkWorkspaceOrGallery = async () => {
                return await this.safeEvaluate(targetPage, () => {
                    const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
                    const hasNewProject = textNodes.some(el => {
                        if (!el.textContent) return false;
                        const t = el.textContent.trim().toLowerCase();
                        return t.includes('dự án mới') ||
                            t.includes('new project') ||
                            t.includes('create new project');
                    });
                    return hasNewProject || !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                });
            };

            let isLoggedIn = await checkWorkspaceOrGallery();
            let currentUrl = await targetPage.url();

            // If we are already logged in to Google but on the intermediate myaccount page, redirect to Flow
            if (!isLoggedIn && currentUrl.includes('myaccount.google.com')) {
                this.log('Already logged in to Google but on Account page. Redirecting to Flow...');
                await targetPage.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await this.sleep(1500 + Math.random() * 1000);
                isLoggedIn = await checkWorkspaceOrGallery();
                currentUrl = await targetPage.url();
            }

            // If we are on the Intro page, try to click the button to see if we can enter the gallery automatically
            if (!isLoggedIn && currentUrl.includes('labs.google/fx/vi/tools/flow')) {
                const introBtnCoords = await this.safeEvaluate(targetPage, () => {
                    const allElements = document.querySelectorAll('button, [role="button"], a, div, span');
                    for (const el of allElements) {
                        if (!el.textContent) continue;
                        const t = el.textContent.trim();
                        const tl = t.toLowerCase();
                        if ((tl === 'create with google flow' || tl === 'tạo bằng google flow' ||
                            tl === 'create with flow' || tl === 'tạo bằng flow') && t.length < 50) {
                            const r = el.getBoundingClientRect();
                            if (r.width > 30 && r.height > 15 && r.width < 500) {
                                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                            }
                        }
                    }
                    return null;
                }).catch(() => null);

                let clickedIntro = false;
                try {
                    const introBtn = targetPage.locator('button, [role="button"], a').filter({
                        hasText: /Create with Google Flow|Tạo bằng Google Flow|Create with Flow|Tạo bằng Flow/i
                    }).first();
                    if (await introBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
                        this.log('[Login] Found Intro Page CTA. Clicking to check if session is active via locator...');
                        await introBtn.click({ timeout: 4000 });
                        clickedIntro = true;
                    }
                } catch (locErr) {
                    this.log(`[Login] Locator intro CTA click failed: ${locErr.message}, trying coordinate fallback...`);
                }

                if (!clickedIntro && introBtnCoords) {
                    this.log('[Login] Found Intro Page CTA via legacy evaluate. Clicking coordinate fallback...');
                    await this.humanClick(targetPage,
                        introBtnCoords.x + (Math.random() * 6 - 3),
                        introBtnCoords.y + (Math.random() * 4 - 2),
                        { reason: 'intro_cta_coordinate_fallback' }
                    );
                    clickedIntro = true;
                }

                if (clickedIntro) {
                    await this.sleep(1500 + Math.random() * 1000);
                    isLoggedIn = await checkWorkspaceOrGallery();
                    currentUrl = await targetPage.url();
                }
            }

            // If not immediately logged in, check if we are on the Google Login page (or redirected there after clicking Intro CTA)
            if (!isLoggedIn || currentUrl.includes('accounts.google.com') || currentUrl.includes('AccountChooser') || currentUrl.includes('signin')) {
                this.log('[Login Mutex] Đang chờ khóa Login Mutex để tránh xung đột gõ chữ...');
                await globalLoginMutex.acquire();
                this.log('[Login Mutex] Đã lấy được khóa Login Mutex. Bắt đầu luồng đăng nhập...');

                let needManualLogin = false;
                let autoLoginErrorMsg = '';

                try {
                    // Intelligent Mutex recheck: If another worker completed the login while we waited, bypass the sequence
                    isLoggedIn = await checkWorkspaceOrGallery();
                    currentUrl = await targetPage.url();
                    if (isLoggedIn && !currentUrl.includes('accounts.google.com') && !currentUrl.includes('signin') && !currentUrl.includes('AccountChooser')) {
                        this.log('[Login Mutex] Phiên đăng nhập đã được khôi phục bởi worker khác. Bỏ qua luồng đăng nhập...');
                        return;
                    }

                    // Auto-login if credentials available, otherwise fall back to manual
                    if (!this.accountData.password) {
                        this.log('No password stored. Opening for manual login inside Mutex...');
                        await targetPage.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                        await this.waitForManualLogin();
                        return;
                    }

                    this.log('Login sequence required.');

                    const email = this.accountData.email;
                    const pwd = decrypt(this.accountData.password);
                    const rawTfa = decrypt(this.accountData.twoFactorSecret);
                    const tfaSecret = rawTfa ? rawTfa.replace(/\s+/g, '') : '';

                    if (email && pwd) {
                        this.log('Auto-login initiated for ' + email);

                        // ----------------------------------------------------
                        // ADDED: Account Chooser Recovery (Signed Out Session)
                        // ----------------------------------------------------
                        this.log('Checking for Account Chooser / Signed Out state...');
                        try {
                            const accountChooserHandled = await this.safeEvaluate(targetPage, async (targetEmail) => {
                                const allElements = document.querySelectorAll('div, span');

                                for (let el of allElements) {
                                    if (el.textContent && el.textContent.trim().toLowerCase() === targetEmail.trim().toLowerCase()) {
                                        const r = el.getBoundingClientRect();
                                        if (r.width > 0 && r.height > 0) {
                                            return { action: 'email', x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                                        }
                                    }
                                }

                                // If email not found but we are on Account Chooser, try to click "Use another account"
                                for (let el of allElements) {
                                    if (el.textContent) {
                                        const t = el.textContent.trim().toLowerCase();
                                        if (t === 'use another account' || t === 'sử dụng tài khoản khác') {
                                            const r = el.getBoundingClientRect();
                                            if (r.width > 0 && r.height > 0) {
                                                return { action: 'other', x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                                            }
                                        }
                                    }
                                }

                                return null;
                            }, email);

                            let clickedAccount = false;
                            try {
                                if (accountChooserHandled) {
                                    if (accountChooserHandled.action === 'email') {
                                        const emailLoc = targetPage.locator('div, span').filter({ hasText: new RegExp(this.escapeRegex(email), 'i') }).first();
                                        if (await emailLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
                                            await emailLoc.click();
                                            this.log(`[Locator] Clicked saved account: ${email}`);
                                            clickedAccount = true;
                                        }
                                    } else {
                                        const otherLoc = targetPage.locator('div, span, button').filter({ hasText: /Use another account|Sử dụng tài khoản khác/i }).first();
                                        if (await otherLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
                                            await otherLoc.click();
                                            this.log('[Locator] Clicked "Use another account"');
                                            clickedAccount = true;
                                        }
                                    }
                                }
                            } catch (locErr) {
                                this.log(`Locator account chooser click failed: ${locErr.message}, falling back to coords...`);
                            }

                            if (!clickedAccount && accountChooserHandled) {
                                await this.humanClick(targetPage, accountChooserHandled.x, accountChooserHandled.y, { reason: 'account_chooser_fallback' });
                                if (accountChooserHandled.action === 'email') {
                                    this.log(`[Fallback] Found and clicked saved account: ${email}`);
                                } else {
                                    this.log('[Fallback] Clicked "Use another account" — proceeding to manual email entry.');
                                }
                                clickedAccount = true;
                            }
                            if (clickedAccount) {
                                await this.sleep(1000 + Math.random() * 500);
                            }
                        } catch (e) {
                            // Suppress error and continue to normal email input
                        }
                        // ----------------------------------------------------

                        // Ensure we are on accounts.google.com before looking for login fields
                        const currentLoginUrl = targetPage.url();
                        if (!currentLoginUrl.includes('accounts.google.com')) {
                            this.log('Not on Google login page yet. Navigating to accounts.google.com...');
                            await targetPage.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                            await this.sleep(1500 + Math.random() * 800);
                        }

                        // Race giữa 3 trạng thái: email input, password input, hoặc đã logged in
                        this.log('Waiting for auth state (email/password/workspace)...');
                        const emailSelector = 'input[type="email"], input[name="identifier"]';
                        const pwdSelectorRace = 'input[type="password"], input[name="Passwd"]';
                        const workspaceSelector = '[data-slate-editor="true"][role="textbox"]';
                        let authState = 'email'; // Default fallback
                        try {
                            authState = await Promise.race([
                                targetPage.waitForSelector(emailSelector, { timeout: 15000, state: 'visible' })
                                    .then(() => 'email'),
                                targetPage.waitForSelector(pwdSelectorRace, { timeout: 15000, state: 'visible' })
                                    .then(() => 'password'),
                                targetPage.waitForSelector(workspaceSelector, { timeout: 15000, state: 'visible' })
                                    .then(() => 'workspace'),
                            ]);
                        } catch (raceErr) {
                            this.log(`[Login] Auth state race timeout or failed: ${raceErr.message}. Defaulting to email flow.`);
                        }

                        this.log(`[Login] Auth state detected: ${authState}`);
                        if (authState === 'workspace') {
                            this.log('[Login] Already logged in! Skipping login flow.');
                            return; // Bypass login
                        }

                        if (authState === 'email') {
                            this.log('Waiting for Email input...');
                            try {
                                this.log('Found Email input. Waiting for page to fully load...');
                                await this.sleep(1000 + Math.random() * 500);

                                // Tối ưu hóa nhập liệu bypass lỗi che phủ pointer-events bằng focus + insertText
                                try {
                                    this.log('Focusing and entering Email...');
                                    await targetPage.focus(emailSelector, { timeout: 5000 });
                                    await this.sleep(500);
                                    await targetPage.fill(emailSelector, '', { timeout: 3000 }).catch(() => { });
                                    await targetPage.keyboard.insertText(email);
                                } catch (fillErr) {
                                    this.log(`Fallback to direct click & fill for email: ${fillErr.message}`);
                                    await targetPage.click(emailSelector, { force: true, timeout: 5000 }).catch(() => { });
                                    await this.sleep(500);
                                    await targetPage.fill(emailSelector, email, { timeout: 5000 });
                                }

                                const emailWaitMs = Math.floor(Math.random() * (1500 - 1000 + 1)) + 1000;
                                this.log(`Waiting ${Math.floor(emailWaitMs / 1000)}s after typing Email...`);
                                await this.sleep(emailWaitMs);

                                // Click "Next" / "Tiếp theo" button using standard Google IDs and locator (cực nhanh)
                                let clickedNext = false;
                                try {
                                    const identifierNext = targetPage.locator('#identifierNext');
                                    if (await identifierNext.isVisible({ timeout: 2000 }).catch(() => false)) {
                                        await identifierNext.click({ force: true, timeout: 3000 });
                                        clickedNext = true;
                                    }

                                    if (!clickedNext) {
                                        const nextBtn = targetPage.locator('button, [role="button"], #identifierNext').filter({ hasText: /Next|Tiếp theo|Tiếp tục|Continue/i }).first();
                                        if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                                            await nextBtn.click({ force: true, timeout: 3000 });
                                            clickedNext = true;
                                        }
                                    }
                                } catch (e) { }

                                if (!clickedNext) {
                                    this.log('Could not click Next button, falling back to Enter key...');
                                    await targetPage.click(emailSelector, { force: true, timeout: 2000 }).catch(() => { });
                                    await targetPage.keyboard.press('Enter');
                                }

                                this.log('Email submitted.');

                                // VERIFY: Check if we actually moved past the email page
                                // Wait up to 5s for the email input to disappear (page transition to password)
                                let movedPastEmail = false;
                                for (let vc = 0; vc < 5; vc++) {
                                    await this.sleep(1000);
                                    const emailStillVisible = await targetPage.locator(emailSelector).isVisible({ timeout: 1000 }).catch(() => false);
                                    if (!emailStillVisible) {
                                        movedPastEmail = true;
                                        break;
                                    }
                                    // Check if password field appeared (some layouts show both)
                                    const pwdVisible = await targetPage.locator('input[type="password"]:visible, input[name="Passwd"]:visible').isVisible({ timeout: 500 }).catch(() => false);
                                    if (pwdVisible) {
                                        movedPastEmail = true;
                                        break;
                                    }
                                }

                                if (!movedPastEmail) {
                                    this.log('[Login] ⚠ Still on email page after submit! Retrying with type() strategy...');
                                    // Strategy 2: Clear field, click, and type character by character
                                    try {
                                        await targetPage.click(emailSelector, { force: true, timeout: 3000 });
                                        await this.sleep(300);
                                        await targetPage.fill(emailSelector, '', { timeout: 2000 }).catch(() => { });
                                        await targetPage.type(emailSelector, email, { delay: 50 + Math.random() * 30 });
                                        await this.sleep(800);
                                        await targetPage.keyboard.press('Enter');
                                        this.log('[Login] Email re-submitted via type() + Enter.');
                                        await this.sleep(2000 + Math.random() * 1000);
                                    } catch (retryErr) {
                                        this.log(`[Login] Retry email also failed: ${retryErr.message}`);
                                    }
                                }
                            } catch (err) {
                                this.log(`Email input error or not found: ${err.message}. We might already be on the password page or logged in.`);
                            }
                        }

                        // Wait for password field
                        this.log('Waiting for Password input...');
                        const pwdSelector = 'input[type="password"], input[name="Passwd"]';
                        try {
                            await targetPage.waitForSelector(pwdSelector, { timeout: 15000, state: 'visible' });
                            this.log('Found Password input. Waiting for page to fully load...');
                            await this.sleep(1000 + Math.random() * 500);

                            // Tối ưu hóa nhập liệu bypass lỗi che phủ pointer-events bằng focus + insertText
                            try {
                                this.log('Focusing and entering Password...');
                                await targetPage.focus(pwdSelector, { timeout: 5000 });
                                await this.sleep(500);
                                await targetPage.fill(pwdSelector, '', { timeout: 3000 }).catch(() => { });
                                await targetPage.keyboard.insertText(pwd);
                            } catch (fillErr) {
                                this.log(`Fallback to direct click & fill for password: ${fillErr.message}`);
                                await targetPage.click(pwdSelector, { force: true, timeout: 5000 }).catch(() => { });
                                await this.sleep(500);
                                await targetPage.fill(pwdSelector, pwd, { timeout: 5000 });
                            }

                            const pwdWaitMs = Math.floor(Math.random() * (1500 - 1000 + 1)) + 1000;
                            this.log(`Waiting ${Math.floor(pwdWaitMs / 1000)}s after typing Password...`);
                            await this.sleep(pwdWaitMs);

                            let clickedPwdNext = false;
                            try {
                                const passwordNext = targetPage.locator('#passwordNext');
                                if (await passwordNext.isVisible({ timeout: 2000 }).catch(() => false)) {
                                    await passwordNext.click({ force: true, timeout: 3000 });
                                    clickedPwdNext = true;
                                }

                                if (!clickedPwdNext) {
                                    const nextBtn = targetPage.locator('button, [role="button"], #passwordNext').filter({ hasText: /Next|Tiếp theo|Tiếp tục|Continue/i }).first();
                                    if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                                        await nextBtn.click({ force: true, timeout: 3000 });
                                        clickedPwdNext = true;
                                    }
                                }
                            } catch (e) { }

                            if (!clickedPwdNext) {
                                this.log('Could not click Next button, falling back to Enter key...');
                                await targetPage.click(pwdSelector, { force: true, timeout: 2000 }).catch(() => { });
                                await targetPage.keyboard.press('Enter');
                            }

                            this.log('Password submitted.');
                        } catch (err) {
                            this.log(`Password input error or not found: ${err.message}`);
                        }

                        this.log('Checking for 2FA or success redirect...');

                        let loginSuccess = false;

                        if (tfaSecret) {
                            this.log('Account has 2FA Secret. Waiting for 2FA form...');
                            try {
                                this.log('Scanning for OTP input field...');
                                await this.sleep(2000 + Math.random() * 1000);

                                const totp = new OTPAuth.TOTP({
                                    issuer: 'Google',
                                    label: 'Account',
                                    algorithm: 'SHA1',
                                    digits: 6,
                                    period: 30,
                                    secret: tfaSecret
                                });
                                const token = totp.generate();
                                this.log(`[DEBUG] Generated OTP: ${token}`);

                                // Check if we are on the 2FA selection screen (e.g., asked to choose verification method)
                                try {
                                    // Rely mainly on text matching since class names may change
                                    const authOption = targetPage.locator('div, li, span').filter({ hasText: /Authenticator/i }).last();
                                    if (await authOption.isVisible({ timeout: 2000 }).catch(() => false)) {
                                        this.log('Found Google Authenticator option in selection screen, clicking it...');
                                        await authOption.click({ force: true, timeout: 3000 }).catch(() => { });
                                        await this.sleep(2000);
                                    }
                                } catch (e) {
                                    this.log(`Error checking Authenticator option: ${e.message}`);
                                }

                                // Find 2FA input prioritizing Google's totpPin selector and ensuring it is visible
                                const tfaSelector = 'input#totpPin, input[name="totpPin"], input[type="tel"], input[autocomplete="one-time-code"], input[name*="pin" i], input[id*="pin" i]';
                                try {
                                    await targetPage.waitForSelector(tfaSelector, { timeout: 15000, state: 'visible' });
                                    
                                    let attempt = 1;
                                    let success2FA = false;
                                    
                                    while (attempt <= 3 && !success2FA) {
                                        const currentToken = totp.generate();
                                        this.log(`[Attempt ${attempt}/3] Found 2FA input, focusing and entering OTP: ${currentToken}...`);

                                        await targetPage.focus(tfaSelector, { timeout: 5000 });
                                        await this.sleep(500);
                                        await targetPage.click(tfaSelector, { force: true, timeout: 3000 }).catch(() => { });
                                        await this.sleep(300);
                                        
                                        // Robust clear
                                        await targetPage.keyboard.down('Control');
                                        await targetPage.keyboard.press('a');
                                        await targetPage.keyboard.up('Control');
                                        await targetPage.keyboard.press('Backspace');
                                        await this.sleep(300);
                                        
                                        await targetPage.keyboard.insertText(currentToken);

                                        const tfaWaitMs = Math.floor(Math.random() * (1500 - 1000 + 1)) + 1000;
                                        this.log(`Waiting ${Math.floor(tfaWaitMs / 1000)}s after typing 2FA...`);
                                        await this.sleep(tfaWaitMs);

                                        // Click Next using locator with broad text pattern & force click
                                        let clickedTfaNext = false;
                                        try {
                                            const nextBtn = targetPage.locator('button, [role="button"]').filter({ hasText: /Next|Tiếp theo|Tiếp tục|Continue/i }).first();
                                            if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                                                await nextBtn.click({ force: true, timeout: 3000 });
                                                clickedTfaNext = true;
                                            }
                                        } catch (e) { }

                                        if (!clickedTfaNext) {
                                            this.log('Could not click Next, falling back to Enter...');
                                            await targetPage.keyboard.press('Enter');
                                        }

                                        this.log(`OTP ${currentToken} submitted.`);
                                        await this.sleep(3000 + Math.random() * 1000);
                                        
                                        // Check for "Wrong code" or "Sai mã"
                                        const errorLoc = targetPage.locator('text="Wrong code"').or(targetPage.locator('text="Sai mã"')).or(targetPage.locator('text="Try again"')).or(targetPage.locator('text="Thử lại"')).last();
                                        if (await errorLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
                                            this.log(`[STEP 3] ⚠ Wrong 2FA code detected! Waiting 5s before retrying...`);
                                            await this.sleep(5000);
                                            attempt++;
                                        } else {
                                            success2FA = true;
                                        }
                                    }
                                } catch (tfaSelectorErr) {
                                    this.log('No 2FA input found on the page. Skipping auto-2FA...');
                                }
                            } catch (e) {
                                this.log(`Error during 2FA: ${e.message}`);
                            }
                        } else {
                            // Non-2FA accounts: explicitly wait for labs redirect
                            this.log('Tài khoản không có Secret 2FA. Chờ chuyển hướng thẳng...');
                            await this.sleep(1500 + Math.random() * 1000);
                            const url = await targetPage.url();
                            if (url.includes('labs.google') && !url.includes('accounts.google.com')) {
                                loginSuccess = true;
                            }
                        }

                        // Check for security challenge (manual intervention) as a fallback (checking visibility to avoid screenshot hang)
                        const isChallenge = await targetPage.$('#captchaimg');
                        if (isChallenge && await isChallenge.isVisible().catch(() => false)) {
                            const box = await isChallenge.boundingBox().catch(() => null);
                            if (box && box.width > 0 && box.height > 0) {
                                this.log('Phát hiện Captcha hình ảnh. Đang nhờ AI giải mã...');
                                try {
                                    const buffer = await isChallenge.screenshot({ timeout: 5000 });
                                    const b64 = buffer.toString('base64');
                                    const response = await fetch('http://127.0.0.1:5679/api/v1/agent/solve-captcha', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ imageBase64: b64 })
                                    });
                                    const data = await response.json();
                                    if (data.success && data.data && data.data.text) {
                                        const captchaText = data.data.text;
                                        this.log(`AI giải mã Captcha thành công: ${captchaText}`);
                                        const captchaInput = await targetPage.$('input[name="logincaptcha"], #logincaptcha');
                                        if (captchaInput) {
                                            await targetPage.fill('input[name="logincaptcha"], #logincaptcha', captchaText);
                                            await this.sleep(500);
                                            await targetPage.keyboard.press('Enter');
                                            this.log('Đã nhập Captcha và Enter. Chờ tải...');
                                            await this.sleep(2000 + Math.random() * 1000);
                                        }
                                    } else {
                                        this.log('AI không giải mã được Captcha. Bạn có 3 phút gỡ thủ công!');
                                    }
                                } catch (err) {
                                    this.log(`Lỗi khi giải Captcha tự động: ${err.message}. Bạn có 3 phút gỡ thủ công!`);
                                }
                            }
                        } else {
                            const isRecaptcha = await targetPage.$('.g-recaptcha');
                            if (isRecaptcha && await isRecaptcha.isVisible().catch(() => false)) {
                                this.log('⚠ Phát hiện Google reCAPTCHA. Bạn có 3 phút gỡ Captcha thủ công!');
                            }
                        }

                        // Force redirect if stuck on Google Account settings or other intermediate pages
                        const urlAfterLogin = await targetPage.url();
                        if (urlAfterLogin.includes('myaccount.google.com') || (!urlAfterLogin.includes('labs.google') && !isChallenge)) {
                            this.log(`Stuck on intermediate page (${urlAfterLogin.substring(0, 40)}...). Redirecting to Veo3...`);
                            await this.sleep(2000 + Math.random() * 1000);
                            await targetPage.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                            await this.sleep(1500 + Math.random() * 1000);
                        }

                        // Final wait for redirect back to labs
                        this.log('Waiting for Labs to load post-login...');

                        let postLoginLoaded = false;
                        for (let w = 0; w < 60; w++) {
                            try {
                                const isReady = await targetPage.evaluate(() => {
                                    if (document.querySelector('[data-slate-editor="true"][role="textbox"]')) return true;
                                    const textNodes = Array.from(document.querySelectorAll('div, span, button'));
                                    return textNodes.some(el => el.textContent && (el.textContent.includes('Tạo bằng Flow') || el.textContent.includes('Create with Google Flow') || el.textContent.includes('Create with Flow') || el.textContent.includes('Dự án mới') || el.textContent.includes('New Project')));
                                });

                                if (isReady) {
                                    postLoginLoaded = true;
                                    break;
                                }
                            } catch (e) {
                                // Ignore navigation errors like "Execution context was destroyed" or "frame got detached"
                            }
                            await this.sleep(1000);
                        }

                        if (!postLoginLoaded) {
                            throw new Error("Timeout waiting for post-login screens (Labs / New Project)");
                        }

                        // Now ensure we are on a valid post-login page (editor OR intro page)
                        await targetPage.waitForFunction(() => {
                            const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                            const isFlowPage = window.location.href.includes('labs.google/fx') && window.location.href.includes('/tools/flow');
                            const textNodes = Array.from(document.querySelectorAll('div, span, button'));
                            const hasCreateFlow = textNodes.some(el => el.textContent && (el.textContent.includes('Tạo bằng Flow') || el.textContent.includes('Create with Google Flow') || el.textContent.includes('Create with Flow') || el.textContent.includes('Dự án mới') || el.textContent.includes('New Project')));
                            return hasEditor || isFlowPage || hasCreateFlow;
                        }, { timeout: 30000, polling: 1000 });

                        this.log('Auto-login successful! Proceeding...');

                        // Inform backend to update account to hasProfile = true if necessary
                        if (this.accountData && this.accountData.id && this.automationService && this.automationService.accountManager) {
                            this.automationService.accountManager.updateAccount(this.accountData.id, { hasProfile: true });
                        }
                    } else {
                        this.log('Credentials missing or invalid. Need manual login.');
                        needManualLogin = true;
                    }

                    if (needManualLogin) {
                        this.log(`[Login Mutex] Auto-login requested manual fallback. Waiting for manual login (3 mins)...`);
                        await this.waitForManualLogin();
                    }
                } catch (autoErr) {
                    this.log('Auto-login failed or needed manual intervention: ' + autoErr.message);

                    // Scan for actual Captcha element or robot indicators on DOM
                    const hasCaptchaOnPage = await targetPage.evaluate(() => {
                        const imgCaptcha = document.querySelector('#captchaimg');
                        const reCaptcha = document.querySelector('.g-recaptcha');
                        const isVisible = (el) => el && el.offsetParent !== null;
                        return isVisible(imgCaptcha) || isVisible(reCaptcha) ||
                            document.body.innerText.includes('captcha') ||
                            document.body.innerText.includes('Robot');
                    }).catch(() => false);

                    if (autoErr.message === 'CAPTCHA_STUCK' || hasCaptchaOnPage) {
                        this.log('Phát hiện trình duyệt bị lộ CAPTCHA. Tự động khởi động lại trình duyệt và đổi vân tay mới...');
                        await this.performBrowserRestart('CAPTCHA_STUCK');
                        return; // Dừng luồng hiện tại vì restart đã tạo luồng mới
                    }

                    // Check if we are actually already logged in to Google/Labs to bypass manual wait
                    // GUARD: Wrap in try-catch because targetPage.url() / evaluate() can also throw
                    // "Execution context was destroyed" when a navigation just happened.
                    // In that case, wait for the page to stabilize and retry.
                    try {
                        // If context was destroyed by navigation, wait for page to settle
                        if (autoErr.message && autoErr.message.includes('Execution context was destroyed')) {
                            this.log('[Login Recovery] Context destroyed by navigation — waiting for page to stabilize...');
                            await this.sleep(3000 + Math.random() * 1000);
                            // Wait for the page to finish loading after navigation
                            try {
                                await targetPage.waitForFunction('document.readyState === "complete" || document.readyState === "interactive"', { timeout: 15000 });
                            } catch (e) { /* timeout is ok, proceed with checks */ }
                        }

                        const currentUrl = await targetPage.url();
                        const isWorkspace = await checkWorkspaceOrGallery();
                        if (isWorkspace || currentUrl.includes('myaccount.google.com')) {
                            this.log('Already logged in or on intermediate Google page. Forcing redirect to Flow and bypassing manual login wait...');
                            if (currentUrl.includes('myaccount.google.com')) {
                                await targetPage.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                                await this.sleep(1500 + Math.random() * 1000);
                            }
                            // Must still handle intro page before returning
                            await this._clickCreateFlowIfNeeded();
                            return;
                        }
                    } catch (recoveryErr) {
                        // Even recovery failed — page might still be navigating.
                        // Last resort: wait longer and check if we ended up on Flow
                        this.log(`[Login Recovery] Recovery check also failed: ${recoveryErr.message}. Waiting 5s and retrying...`);
                        await this.sleep(5000);
                        try {
                            const lastChanceUrl = await targetPage.url();
                            if (lastChanceUrl.includes('labs.google/fx')) {
                                const lastChanceWorkspace = await checkWorkspaceOrGallery().catch(() => false);
                                if (lastChanceWorkspace) {
                                    this.log('[Login Recovery] Page stabilized on workspace after wait. Proceeding.');
                                    await this._clickCreateFlowIfNeeded();
                                    return;
                                }
                            }
                        } catch (e) {
                            this.log(`[Login Recovery] Page still unstable: ${e.message}`);
                        }
                    }

                    this.log(`[Login Mutex] Falling back to manual login wait under Mutex (3 mins)... (Reason: ${autoErr.message})`);
                    await this.waitForManualLogin();
                } finally {
                    globalLoginMutex.release();
                    this.log('[Login Mutex] Đã giải phóng khóa Login Mutex.');
                }
            } else {
                // If already logged in, simulate human scrolling
                await this.humanScroll(targetPage);
            }

            // After login (or already logged in), check if we are on the Flow INTRO page
            // and need to click "Create with Google Flow" to enter the workspace
            await this._clickCreateFlowIfNeeded();

        } catch (e) {
            this.log(`Error during login check: ${e.message}`);
            this.isOffline = true;
            await this.close(true).catch(() => { });
            throw e; // Rethrow to fail launch!
        }
    }

    /**
     * Detect and click the "Create with Google Flow" button on the intro/landing page.
     * After login or restart, we may land on the intro page instead of the workspace.
     * This method clicks the CTA button to enter the actual workspace.
     */
    async _clickCreateFlowIfNeeded() {
        if (!this.page) return;
        try {
            const url = await this.page.url();
            // Only applies when on labs.google Flow pages
            if (!url.includes('labs.google')) return;

            // Check if we're on the INTRO page (has "Create with Google Flow" but NOT a workspace)
            const introState = await this.page.evaluate(() => {
                const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                if (hasEditor) return { isIntro: false }; // Already in workspace

                // Check for workspace indicators (project list, editor)
                const hasProjectList = !!document.querySelector('[class*="project"]');
                const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
                const hasNewProject = textNodes.some(el => {
                    if (!el.textContent) return false;
                    const t = el.textContent.trim().toLowerCase();
                    return t === 'dự án mới' || t === 'new project';
                });
                if (hasNewProject) return { isIntro: false }; // Already in workspace

                // Look for the intro CTA button
                for (const el of textNodes) {
                    if (!el.textContent) continue;
                    const t = el.textContent.trim().toLowerCase();
                    if (t === 'create with google flow' || t === 'tạo bằng google flow' ||
                        t === 'create with flow' || t === 'tạo bằng flow') {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return {
                                isIntro: true,
                                x: r.x + r.width / 2 + (Math.random() * 4 - 2),
                                y: r.y + r.height / 2 + (Math.random() * 4 - 2)
                            };
                        }
                    }
                }
                return { isIntro: false };
            });

            if (introState && introState.isIntro) {
                this.log('[Login] Detected Flow INTRO page. Clicking "Create with Google Flow" button...');
                await this.humanClick(this.page, introState.x, introState.y);
                await this.sleep(2000 + Math.random() * 1000); // Wait for workspace to load

                // Verify we entered the workspace
                const postClickUrl = await this.page.url();
                this.log(`[Login] After clicking intro CTA, URL: ${postClickUrl.substring(0, 60)}...`);

                // If we're still on the intro page, try navigating directly to a project page
                const stillIntro = await this.page.evaluate(() => {
                    const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                    const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
                    const hasNewProject = textNodes.some(el => {
                        if (!el.textContent) return false;
                        const t = el.textContent.trim().toLowerCase();
                        return t === 'dự án mới' || t === 'new project';
                    });
                    return !hasEditor && !hasNewProject;
                });

                if (stillIntro) {
                    this.log('[Login] Still on intro page after click. Trying direct navigation to Flow workspace...');
                    await this.page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                    await this.sleep(1500 + Math.random() * 1000);
                } else {
                    this.log('[Login] ✓ Successfully entered Flow workspace!');
                }
            }
        } catch (e) {
            this.log(`[Login] Warning during intro page check: ${e.message}`);
        }
    }

    async waitForManualLogin() {
        try {
            await this.page.waitForFunction(
                () => {
                    const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                    const isFlowPage = window.location.href.includes('labs.google/fx') && window.location.href.includes('/tools/flow');
                    const isMyAccount = window.location.href.includes('myaccount.google.com');
                    const textNodes = Array.from(document.querySelectorAll('div, span, button'));
                    const hasCreateFlow = textNodes.some(el => el.textContent && (el.textContent.includes('Tạo bằng Flow') || el.textContent.includes('Create with Google Flow') || el.textContent.includes('Create with Flow') || el.textContent.includes('Dự án mới') || el.textContent.includes('New Project')));
                    return hasEditor || isFlowPage || isMyAccount || hasCreateFlow;
                },
                { timeout: 180000, polling: 1000 }
            );

            // Double check if we need to redirect
            const currentUrl = await this.page.url();
            if (currentUrl.includes('myaccount.google.com') || (currentUrl.includes('labs.google') && !currentUrl.includes('tools/flow'))) {
                this.log('Detected successful login. Redirecting to Veo3 Flow page...');
                await this.page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await this.sleep(1500 + Math.random() * 1000);
            }

            this.log('Login successful! Proceeding...');

            // If logged in successfully, update hasProfile flag
            if (this.accountData && this.accountData.id && this.automationService && this.automationService.accountManager) {
                this.automationService.accountManager.updateAccount(this.accountData.id, { hasProfile: true });
            }
        } catch (timeoutErr) {
            this.log('Login wait timed out or browser was closed.');
            throw new Error('Manual login timeout or browser closed by Stop Auto.');
        }
    }

    getRand(base) {
        return base + Math.floor(Math.random() * 11) - 5;
    }

    escapeRegex(string) {
        return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
    }

    async humanClick(page, x, y, options = {}) {
        if (!page || page.isClosed()) return false;
        const reason = options.reason || 'coordinate_fallback';
        this.log(`[Mouse] Coordinate click used (Reason: ${reason}) at x:${Math.round(x)}, y:${Math.round(y)}`);
        try {
            // Calculate smooth mouse movement from previous coordinate to (x, y)
            const steps = 12 + Math.floor(Math.random() * 9);
            await page.mouse.move(x, y, { steps });
            // Natural hover pause (200ms - 450ms) to simulate physical click preparation
            await this.sleep(options.preClickDelayMs ?? (180 + Math.floor(Math.random() * 220)));
            this.mousePos = { x, y };
        } catch (e) {
            this.log(`[Mouse] Smooth mouse move warning: ${e.message}`);
        }
        // Goes through CloakBrowser Bézier humanize pipeline for accurate clicks
        const clickOptions = { button: options.button || 'left' };
        if (options.humanConfig) clickOptions.humanConfig = options.humanConfig;
        await page.mouse.click(x, y, clickOptions);
        return true;
    }

    async directClick(page, x, y, options = {}) {
        if (!page || page.isClosed()) return false;
        const button = options.button || 'left';
        if (page._original) {
            await page._original.mouseClick(x, y, { button });
        } else {
            await page.mouse.click(x, y, { button });
        }
        return true;
    }

    async humanElClick(page, target, options = {}) {
        if (!page || !target) return false;

        if (typeof target.click === 'function' && typeof target.boundingBox !== 'function') {
            await target.click(options);
            return true;
        }

        this.log('[Click] ElementHandle coordinate fallback used; prefer locator.click() when possible.');
        const box = await target.boundingBox().catch(() => null);
        if (!box || box.width <= 0 || box.height <= 0) return false;

        const maxOffset = Math.min(box.width, box.height) < 30 ? 1 : 3;
        return this.humanClick(
            page,
            box.x + box.width / 2 + (Math.random() * maxOffset * 2 - maxOffset),
            box.y + box.height / 2 + (Math.random() * maxOffset * 2 - maxOffset),
            options
        );
    }

    async clickLocator(locator, options = {}) {
        if (!locator) return false;
        await locator.click(options);
        return true;
    }

    async clickByText(page, selector, textRegex, options = {}) {
        if (!page) return false;
        try {
            const locators = page.locator(selector);
            const count = await locators.count().catch(() => 0);

            for (let i = 0; i < count; i++) {
                const item = locators.nth(i);
                const text = await item.innerText().catch(() => '');
                if (textRegex.test(text)) {
                    const isVisible = await item.isVisible().catch(() => false);
                    const isEnabled = await item.isEnabled().catch(() => false);
                    if (isVisible && isEnabled) {
                        this.log(`[ClickByText] Clicking element "${text.trim().substring(0, 30)}" via locator...`);
                        await item.click(options.clickOptions || {});
                        return true;
                    }
                }
            }

            const loc = page.locator(selector).filter({ hasText: textRegex }).last();
            if (await loc.isVisible({ timeout: options.timeout || 3000 }).catch(() => false)) {
                await loc.click(options.clickOptions || {});
                return true;
            }
        } catch (e) {
            this.log(`[ClickByText] Click failed: ${e.message}`);
        }
        return false;
    }

    async findNodeByTextExact(page, matchesArr) {
        if (!page) return null;
        try {
            return await page.evaluate((texts) => {
                const lowerTexts = texts.map(t => t.toLowerCase());

                // Comprehensive clickable selector including Radix UI roles
                const CLICKABLE = 'button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], li, a, label, span, div.button';

                let textMatches = [];

                // PASS 1: Direct text nodes on ALL elements (deepest match)
                for (const el of document.querySelectorAll('*')) {
                    let directText = '';
                    for (let i = 0; i < el.childNodes.length; i++) {
                        if (el.childNodes[i].nodeType === Node.TEXT_NODE) {
                            directText += el.childNodes[i].textContent;
                        }
                    }
                    directText = directText.trim().toLowerCase();

                    if (directText && lowerTexts.includes(directText)) {
                        textMatches.push(el);
                    }
                }

                // PASS 2: Google Material Icons (i.google-symbols text content)
                if (textMatches.length === 0) {
                    for (const icon of document.querySelectorAll('i.google-symbols, i[class*="google-symbols"]')) {
                        const iconText = (icon.textContent || '').trim().toLowerCase();
                        if (iconText && lowerTexts.includes(iconText)) {
                            textMatches.push(icon);
                        }
                    }
                }

                // PASS 3: Full textContent on clickable elements only (innerText causes severe layout thrashing)
                if (textMatches.length === 0) {
                    const all = Array.from(document.querySelectorAll(CLICKABLE));
                    for (const el of all) {
                        const t = (el.textContent || '').trim().toLowerCase();
                        if (t && lowerTexts.includes(t)) {
                            textMatches.push(el);
                        }
                    }
                }

                if (textMatches.length > 0) {
                    // Reverse loop: Radix UI portals are appended at end of <body>
                    // So the LAST matching element is most likely inside the active popup
                    for (let i = textMatches.length - 1; i >= 0; i--) {
                        const match = textMatches[i];
                        const clickable = match.closest(CLICKABLE) || match;
                        const r = clickable.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                        }
                    }
                }
                return null;
            }, matchesArr);
        } catch (e) {
            return null;
        }
    }

    async findNodeBySelector(page, selector) {
        if (!page) return null;
        try {
            const elements = await page.$$(selector);
            // Reverse loop: prioritize the last rendered component (active open popups)
            for (let i = elements.length - 1; i >= 0; i--) {
                const el = elements[i];
                const box = await el.boundingBox();
                if (box && box.width > 0 && box.height > 0) {
                    return { x: box.x + box.width / 2 + (Math.random() * 10 - 5), y: box.y + box.height / 2 + (Math.random() * 10 - 5) };
                }
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    /**
     * Fix #5: Click model dropdown trigger with verification.
     * Clicks the trigger, checks if Radix dropdown actually opened,
     * retries up to 2 times, then selects the target model.
     */
    async clickModelDropdownWithVerify(page, clickCoord, coords, triggerKey, modelName) {
        const MAX_RETRIES = 2;

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            // Count visible menus BEFORE click (to detect NEW dropdown vs existing popup)
            const menuCountBefore = await page.evaluate(() => {
                let count = 0;
                const menus = document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
                for (const m of menus) {
                    const r = m.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) count++;
                }
                return count;
            }).catch(() => 0);

            await clickCoord(coords.model, triggerKey);
            await this.sleep(800);

            // Count menus AFTER click — a NEW menu means dropdown opened
            const menuCountAfter = await page.evaluate(() => {
                let count = 0;
                const menus = document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
                for (const m of menus) {
                    const r = m.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) count++;
                }
                return count;
            }).catch(() => 0);

            const newMenuOpened = menuCountAfter > menuCountBefore;

            if (newMenuOpened) {
                this.log(`Model dropdown verified open (attempt ${attempt + 1}). Menus: ${menuCountBefore} -> ${menuCountAfter}`);
                break;
            } else if (attempt < MAX_RETRIES) {
                this.log(`⚠️ Model dropdown not detected (menus: ${menuCountBefore} -> ${menuCountAfter}). Retrying (${attempt + 1}/${MAX_RETRIES})...`);
                await this.humanClick(page, 150 + Math.random() * 100, 400 + Math.random() * 100);
                await this.sleep(500);
            } else {
                this.log(`⚠️ Model dropdown failed to open after ${MAX_RETRIES + 1} attempts. Proceeding anyway...`);
            }
        }

        // Select the model item
        await clickCoord(coords.model, modelName);
        await this.sleep(600);
    }

    /**
     * Option B: Auto-Recovery from Edit View
     * Kiểm tra xem giao diện có bị nhảy vào chế độ Edit/Expand không (có nút arrow_back)
     * Nếu có, tự động click nút Back để trở về màn hình làm việc.
     */
    async checkAndRecoverEditView(page) {
        if (!page) return;
        try {
            const recovered = await page.evaluate(() => {
                // CÁCH MỚI NHẤT VÀ CHÍNH XÁC NHẤT: Kiểm tra URL!
                // Workspace: .../tools/flow/project/<id>
                // Edit View: .../tools/flow/project/<id>/edit/<id>
                if (!window.location.href.includes('/edit/')) {
                    return null;
                }

                const backBtns = Array.from(document.querySelectorAll('button, div[role="button"], a'));
                for (let i = backBtns.length - 1; i >= 0; i--) {
                    const btn = backBtns[i];
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    const isBack = aria.includes('back') || aria.includes('quay lại');

                    const icons = Array.from(btn.querySelectorAll('i, span, div.google-symbols, .google-symbols'));
                    const hasArrowBack = icons.some(icon => icon.textContent.trim() === 'arrow_back');

                    if ((isBack || hasArrowBack) && btn.offsetParent !== null) {
                        const r = btn.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                        }
                    }
                }

                // Fallback nếu không tìm thấy nút back: Dùng history.back()
                window.history.back();
                return 'history';
            });

            if (recovered === 'history' || recovered) {
                if (recovered !== 'history') {
                    await this.humanClick(page, recovered.x, recovered.y);
                }
                this.log('⚠️ [Tracking] Phát hiện kẹt ở giao diện Edit ảnh (URL chứa /edit/). Đã tự động ấn nút Quay lại (Back)!');
                await this.sleep(1200 + Math.random() * 800);
            }
        } catch (e) {
            this.log(`[Tracking] Lỗi khi kiểm tra Edit view: ${e.message}`);
        }
    }

    async ensureVirtuosoGalleryLoaded(page, timeoutMs = 10000) {
        this.log(`[Gallery] Chờ Virtuoso Gallery hiển thị và sẵn sàng (timeout: ${timeoutMs / 1000}s)...`);
        try {
            const result = await page.waitForFunction(() => {
                // 1. Kiểm tra trạng thái rỗng (Empty State) trước
                const emptyStateImg = document.querySelector('img[src*="flower-placeholder"]');
                if (emptyStateImg && emptyStateImg.offsetParent !== null) {
                    return 'EMPTY_STATE';
                }

                const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                if (!dialog) return false;

                const scroller = dialog.querySelector('[data-testid="virtuoso-scroller"][data-virtuoso-scroller="true"]');
                if (!scroller) return false;

                const list = scroller.querySelector('[data-testid="virtuoso-item-list"]');
                if (!list) return false;

                const scrollerVisible = scroller.offsetParent !== null && scroller.getBoundingClientRect().width > 0;
                return scrollerVisible ? 'READY' : false;
            }, { timeout: timeoutMs, polling: 300 });

            const status = await result.jsonValue();
            this.log(`[Gallery] Trạng thái Virtuoso Gallery: ${status}`);
            if (status === 'READY') {
                this.log('[Gallery] [gallery_scope_found] Cấu trúc Virtuoso Gallery đã sẵn sàng.');
            }
            return status;
        } catch (err) {
            this.log(`[Gallery] 🛑 Fail-Fast: GALLERY_SCOPE_NOT_FOUND (Thư viện không hiển thị sau ${timeoutMs / 1000} giây): ${err.message}`);
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: GALLERY_SCOPE_NOT_FOUND');
        }
    }

    /**
     * Try to find and click an existing image in the gallery dialog.
     * Uses the search input to filter gallery, then clicks matching result.
     * Returns true if found and clicked, false otherwise.
     */
    async tryClickGalleryImage(page, filePath) {
        const fileName = path.basename(filePath);
        const filePrefix = fileName.replace(/\.[^.]+$/, '');
        const truncated15 = filePrefix.substring(0, 15);
        const truncated20 = filePrefix.substring(0, 20);
        const searchQuery = filePrefix.substring(0, 5);

        const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(filePath);
        this.log(`[Gallery] Checking gallery for "${filePrefix.substring(0, 20)}" (isVideo: ${isVideo})...`);

        // Giả lập thời gian quét mắt xác định hộp thoại và tìm kiếm sơ bộ (1000ms - 2200ms)
        await this.sleep(1000 + Math.floor(Math.random() * 1200));

        // Đợi cấu trúc Virtuoso Gallery tải xong và ổn định
        const galleryStatus = await this.ensureVirtuosoGalleryLoaded(page, 10000);
        if (galleryStatus === 'EMPTY_STATE') {
            this.log('[Gallery] Empty state detected during loading wait. Skipping gallery check.');
            return { success: false, reason: 'EMPTY_STATE' };
        }

        const scanResult = await page.evaluate(({ fileName, filePrefix, truncated15, truncated20, isVideo }) => {
            // Check for empty state first
            const emptyStateImg = document.querySelector('img[src*="flower-placeholder"]');
            if (emptyStateImg && emptyStateImg.offsetParent !== null) {
                return { success: false, reason: 'EMPTY_STATE' };
            }

            const getVirtuosoGalleryScope = () => {
                const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                if (!dialog) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'DIALOG_NOT_FOUND' };

                const scroller = dialog.querySelector('[data-testid="virtuoso-scroller"][data-virtuoso-scroller="true"]');
                if (!scroller) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'SCROLLER_NOT_FOUND' };

                const list = scroller.querySelector('[data-testid="virtuoso-item-list"]');
                if (!list) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'LIST_NOT_FOUND' };

                const scrollerRect = scroller.getBoundingClientRect();
                const listRect = list.getBoundingClientRect();

                if (scroller.offsetParent === null || scrollerRect.width === 0 || scrollerRect.height === 0) {
                    return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'SCROLLER_NOT_VISIBLE' };
                }

                return {
                    success: true,
                    dialog,
                    scroller,
                    list,
                    scrollerRect: { x: scrollerRect.x, y: scrollerRect.y, width: scrollerRect.width, height: scrollerRect.height, top: scrollerRect.top, bottom: scrollerRect.bottom, left: scrollerRect.left, right: scrollerRect.right },
                    listRect: { x: listRect.x, y: listRect.y, width: listRect.width, height: listRect.height, top: listRect.top, bottom: listRect.bottom, left: listRect.left, right: listRect.right }
                };
            };

            const scope = getVirtuosoGalleryScope();
            if (!scope.success) {
                return { success: false, error: scope.error, reason: scope.reason };
            }

            const list = scope.list;
            const scrollerRect = scope.scrollerRect;
            const listRect = scope.listRect;

            const allOptions = Array.from(list.querySelectorAll('[role="option"]'));
            const options = allOptions.filter(opt => {
                const parent = opt.parentElement;
                const grandparent = parent ? parent.parentElement : null;
                const parentIndex = parent ? parent.getAttribute('data-index') : null;
                const grandparentIndex = grandparent ? grandparent.getAttribute('data-index') : null;
                return parentIndex !== null || grandparentIndex !== null;
            });

            let matchedOption = null;
            let matchIndex = -1;

            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                if (opt.offsetParent === null) continue;

                const nameEl = opt.querySelector('div[class*="jSAmQ"]') || opt.querySelector('div:last-child > div:first-child');
                const typeEl = opt.querySelector('div[class*="duhSJu"]') || opt.querySelector('div:last-child > div:last-child');
                const itemText = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim().toLowerCase() : '';
                const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';

                const isOptionVideo = itemType.includes('video');
                if (isVideo && !isOptionVideo) continue;
                if (!isVideo && isOptionVideo) continue;

                const txt = itemText || (opt.innerText || opt.textContent || '').trim().toLowerCase();
                const imgEl = opt.querySelector('img');

                let textMatched = false;
                let imgMatched = false;

                textMatched = txt.length >= 4 && (
                    txt.includes(fileName.toLowerCase()) ||
                    txt.includes(filePrefix.toLowerCase()) ||
                    txt.includes(truncated15.toLowerCase()) ||
                    txt.includes(truncated20.toLowerCase())
                );

                if (imgEl) {
                    const alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                    const src = (imgEl.getAttribute('src') || '').toLowerCase();
                    imgMatched = alt.includes(fileName.toLowerCase()) || src.includes(fileName.toLowerCase()) ||
                        alt.includes(filePrefix.toLowerCase()) || src.includes(filePrefix.toLowerCase()) ||
                        alt.includes(truncated15.toLowerCase()) || src.includes(truncated15.toLowerCase()) ||
                        alt.includes(truncated20.toLowerCase()) || src.includes(truncated20.toLowerCase());
                }

                if (textMatched || imgMatched) {
                    matchedOption = opt;
                    matchIndex = i;
                    break;
                }
            }

            if (matchedOption) {
                const parent = matchedOption.parentElement;
                const grandparent = parent ? parent.parentElement : null;
                const parentIndex = parent ? parent.getAttribute('data-index') : null;
                const grandparentIndex = grandparent ? grandparent.getAttribute('data-index') : null;
                const dataIndex = parentIndex || grandparentIndex;
                if (dataIndex === null) {
                    return { success: false, reason: 'NO_DATA_INDEX' };
                }

                if (matchedOption.getAttribute('role') !== 'option') {
                    return { success: false, reason: 'NOT_AN_OPTION' };
                }

                if (matchedOption.closest('[role="tablist"]') || matchedOption.closest('[role="tab"]') || matchedOption.closest('nav')) {
                    return { success: false, reason: 'TAB_ANCESTOR_FOUND' };
                }

                const typeEl = matchedOption.querySelector('div[class*="duhSJu"]') || matchedOption.querySelector('div:last-child > div:last-child');
                const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';
                if (isVideo) {
                    if (!itemType.includes('video')) {
                        return { success: false, reason: 'EXPECTED_VIDEO_BUT_GOT_IMAGE', itemType };
                    }
                } else {
                    const isImg = itemType.includes('hình ảnh') || itemType.includes('image') || itemType.includes('ảnh') || itemType.includes('photo');
                    if (!isImg) {
                        return { success: false, reason: 'EXPECTED_IMAGE_BUT_GOT_VIDEO', itemType };
                    }
                }

                const imgEl = matchedOption.querySelector('img');
                if (!imgEl) {
                    return { success: false, reason: 'NO_THUMBNAIL' };
                }

                matchedOption.scrollIntoView({ block: 'nearest' });

                const optionRect = matchedOption.getBoundingClientRect();
                const imgRect = imgEl.getBoundingClientRect();

                const inScroller = (
                    optionRect.top >= scrollerRect.top - 1 &&
                    optionRect.bottom <= scrollerRect.bottom + 1 &&
                    optionRect.left >= scrollerRect.left - 1 &&
                    optionRect.right <= scrollerRect.right + 1
                );
                if (!inScroller) {
                    return { success: false, error: 'UNSAFE_GALLERY_CLICK_REJECTED', reason: 'OUTSIDE_SCROLLER', optionRect, scrollerRect };
                }

                // Tìm checkbox hoặc nút chọn trong matchedOption
                const checkbox = matchedOption.querySelector('[role="checkbox"]') ||
                    matchedOption.querySelector('[aria-label*="Chọn"], [aria-label*="Select"], [aria-label*="chọn"]') ||
                    matchedOption.querySelector('div[class*="checkbox"], div[class*="circle"], div[class*="check"]');

                let clickCoords = null;
                if (checkbox) {
                    const cbRect = checkbox.getBoundingClientRect();
                    if (cbRect.width > 0 && cbRect.height > 0) {
                        clickCoords = { x: cbRect.x + cbRect.width / 2, y: cbRect.y + cbRect.height / 2 };
                    }
                }

                if (!clickCoords) {
                    // Click vào góc trên bên trái của thumbnail với offset an toàn (16px) để tránh mở preview
                    clickCoords = { x: imgRect.x + 16, y: imgRect.y + 16 };
                }

                const insideScroller = (
                    clickCoords.x >= scrollerRect.left &&
                    clickCoords.x <= scrollerRect.right &&
                    clickCoords.y >= scrollerRect.top &&
                    clickCoords.y <= scrollerRect.bottom
                );
                const insideList = (
                    clickCoords.x >= listRect.left &&
                    clickCoords.x <= listRect.right &&
                    clickCoords.y >= listRect.top &&
                    clickCoords.y <= listRect.bottom
                );
                if (!insideScroller || !insideList) {
                    return { success: false, error: 'UNSAFE_GALLERY_CLICK_REJECTED', reason: 'CLICK_POINT_OUT_OF_BOUNDS', clickCoords, scrollerRect, listRect };
                }

                const ariaSelected = matchedOption.getAttribute('aria-selected') || 'false';
                const text = (matchedOption.innerText || matchedOption.textContent || '').trim();

                return {
                    success: true,
                    coords: clickCoords,
                    optionRect: { x: optionRect.x, y: optionRect.y, width: optionRect.width, height: optionRect.height },
                    imgRect: { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height },
                    scrollerRect,
                    listRect,
                    dataIndex,
                    itemType,
                    ariaSelected,
                    text,
                    itemCount: options.length,
                    matchIdx: matchIndex
                };
            }

            return { success: false, reason: 'OPTION_NOT_FOUND', itemCount: options.length };
        }, { fileName, filePrefix, truncated15, truncated20, isVideo });

        if (scanResult.error === 'GALLERY_SCOPE_NOT_FOUND') {
            this.log(`[Gallery] 🛑 Fail-Fast: GALLERY_SCOPE_NOT_FOUND (reason: ${scanResult.reason})`);
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: GALLERY_SCOPE_NOT_FOUND');
        }
        if (scanResult.error === 'UNSAFE_GALLERY_CLICK_REJECTED') {
            this.log(`[Gallery] 🛑 Fail-Fast: UNSAFE_GALLERY_CLICK_REJECTED (reason: ${scanResult.reason})`);
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: UNSAFE_GALLERY_CLICK_REJECTED');
        }

        this.log(`[Gallery] Found ${scanResult.itemCount || 0} items in gallery. Match found: ${scanResult.success}`);

        if (scanResult.success) {
            this.log(`[Gallery] 🔍 Click coords & option diagnostics:
  - scrollerRect: ${JSON.stringify(scanResult.scrollerRect)}
  - listRect: ${JSON.stringify(scanResult.listRect)}
  - optionRect: ${JSON.stringify(scanResult.optionRect)}
  - imgRect: ${JSON.stringify(scanResult.imgRect)}
  - clickCoords: ${JSON.stringify(scanResult.coords)}
  - dataIndex: ${scanResult.dataIndex}
  - itemType: "${scanResult.itemType}"`);

            if (scanResult.itemCount < 8) {
                // Giả lập thời gian nhận thức & định vị (600ms - 1200ms) để giống người thật
                await this.sleep(600 + Math.floor(Math.random() * 600));
                this.log(`[Gallery] Direct match found (<8 items). Clicking to select: ${scanResult.coords.x}, ${scanResult.coords.y}`);
                // coordinate fallback is intentional: Virtuoso gallery virtual list scroll item click
                await this.humanClick(page, scanResult.coords.x, scanResult.coords.y, { reason: 'virtuoso_gallery_item' });
                await this.sleep(1200 + Math.random() * 800);
                await this.checkAndRecoverEditView(page);
                this.log('[Gallery] [gallery_item_selected] Selected existing image from gallery.');
                return { success: true, coords: scanResult.coords, scopeValidated: true };
            }
        } else {
            if (scanResult.itemCount < 8) {
                this.log('[Gallery] No match in gallery (<8 items). Will upload fresh.');
                return { success: false };
            }
        }

        const searchInput = page.locator('#quick-search-input, input[placeholder*="Tìm kiếm"], input[placeholder*="Search"]').first();
        if (!(await searchInput.isVisible({ timeout: 5000 }).catch(() => false))) {
            this.log('[Gallery] Search input not found. Skipping gallery check to upload fresh.');
            return { success: false };
        }

        const clearSearchInput = async () => {
            try {
                const isVisible = await searchInput.isVisible().catch(() => false);
                if (isVisible) {
                    await searchInput.click({ humanConfig: { idle_between_actions: false } });
                    await globalUIMutex.acquire();
                    try {
                        await page.keyboard.down('Control');
                        await page.keyboard.press('a');
                        await page.keyboard.up('Control');
                        await page.keyboard.press('Backspace');
                    } finally {
                        globalUIMutex.release();
                    }
                    await this.sleep(800);
                }
            } catch (err) {
                this.log(`[Gallery] Warning: Failed to clear search input: ${err.message}`);
            }
        };

        await searchInput.click({ humanConfig: { idle_between_actions: false } });
        await this.sleep(500);

        await globalUIMutex.acquire();
        try {
            await searchInput.fill(searchQuery);
        } finally {
            globalUIMutex.release();
        }
        await this.sleep(1500);

        // Đợi cấu trúc Virtuoso Gallery tải xong và ổn định sau khi tìm kiếm
        const postSearchStatus = await this.ensureVirtuosoGalleryLoaded(page, 5000).catch(() => null);
        if (postSearchStatus === 'EMPTY_STATE' || !postSearchStatus) {
            this.log('[Gallery] Empty state or loading failed after search. Clearing input and uploading fresh.');
            await clearSearchInput();
            return { success: false, reason: 'EMPTY_STATE_POST_SEARCH' };
        }

        const scanResultAfterSearch = await page.evaluate(({ fileName, filePrefix, truncated15, truncated20, isVideo }) => {
            const getVirtuosoGalleryScope = () => {
                const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                if (!dialog) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'DIALOG_NOT_FOUND' };

                const scroller = dialog.querySelector('[data-testid="virtuoso-scroller"][data-virtuoso-scroller="true"]');
                if (!scroller) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'SCROLLER_NOT_FOUND' };

                const list = scroller.querySelector('[data-testid="virtuoso-item-list"]');
                if (!list) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'LIST_NOT_FOUND' };

                const scrollerRect = scroller.getBoundingClientRect();
                const listRect = list.getBoundingClientRect();

                if (scroller.offsetParent === null || scrollerRect.width === 0 || scrollerRect.height === 0) {
                    return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'SCROLLER_NOT_VISIBLE' };
                }

                return {
                    success: true,
                    dialog,
                    scroller,
                    list,
                    scrollerRect: { x: scrollerRect.x, y: scrollerRect.y, width: scrollerRect.width, height: scrollerRect.height, top: scrollerRect.top, bottom: scrollerRect.bottom, left: scrollerRect.left, right: scrollerRect.right },
                    listRect: { x: listRect.x, y: listRect.y, width: listRect.width, height: listRect.height, top: listRect.top, bottom: listRect.bottom, left: listRect.left, right: listRect.right }
                };
            };

            const scope = getVirtuosoGalleryScope();
            if (!scope.success) {
                return { success: false, error: scope.error, reason: scope.reason };
            }

            const list = scope.list;
            const scrollerRect = scope.scrollerRect;
            const listRect = scope.listRect;

            const allOptions = Array.from(list.querySelectorAll('[role="option"]'));
            const options = allOptions.filter(opt => {
                const parent = opt.parentElement;
                const grandparent = parent ? parent.parentElement : null;
                const parentIndex = parent ? parent.getAttribute('data-index') : null;
                const grandparentIndex = grandparent ? grandparent.getAttribute('data-index') : null;
                return parentIndex !== null || grandparentIndex !== null;
            });

            let matchedOption = null;
            let matchIndex = -1;

            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                if (opt.offsetParent === null) continue;

                const nameEl = opt.querySelector('div[class*="jSAmQ"]') || opt.querySelector('div:last-child > div:first-child');
                const typeEl = opt.querySelector('div[class*="duhSJu"]') || opt.querySelector('div:last-child > div:last-child');
                const itemText = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim().toLowerCase() : '';
                const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';

                const isOptionVideo = itemType.includes('video');
                if (isVideo && !isOptionVideo) continue;
                if (!isVideo && isOptionVideo) continue;

                const txt = itemText || (opt.innerText || opt.textContent || '').trim().toLowerCase();
                const imgEl = opt.querySelector('img');

                let textMatched = false;
                let imgMatched = false;

                textMatched = txt.length >= 4 && (
                    txt.includes(fileName.toLowerCase()) ||
                    txt.includes(filePrefix.toLowerCase()) ||
                    txt.includes(truncated15.toLowerCase()) ||
                    txt.includes(truncated20.toLowerCase())
                );

                if (imgEl) {
                    const alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                    const src = (imgEl.getAttribute('src') || '').toLowerCase();
                    imgMatched = alt.includes(fileName.toLowerCase()) || src.includes(fileName.toLowerCase()) ||
                        alt.includes(filePrefix.toLowerCase()) || src.includes(filePrefix.toLowerCase()) ||
                        alt.includes(truncated15.toLowerCase()) || src.includes(truncated15.toLowerCase()) ||
                        alt.includes(truncated20.toLowerCase()) || src.includes(truncated20.toLowerCase());
                }

                if (textMatched || imgMatched) {
                    matchedOption = opt;
                    matchIndex = i;
                    break;
                }
            }

            if (matchedOption) {
                const parent = matchedOption.parentElement;
                const grandparent = parent ? parent.parentElement : null;
                const parentIndex = parent ? parent.getAttribute('data-index') : null;
                const grandparentIndex = grandparent ? grandparent.getAttribute('data-index') : null;
                const dataIndex = parentIndex || grandparentIndex;
                if (dataIndex === null) {
                    return { success: false, reason: 'NO_DATA_INDEX' };
                }

                if (matchedOption.getAttribute('role') !== 'option') {
                    return { success: false, reason: 'NOT_AN_OPTION' };
                }

                if (matchedOption.closest('[role="tablist"]') || matchedOption.closest('[role="tab"]') || matchedOption.closest('nav')) {
                    return { success: false, reason: 'TAB_ANCESTOR_FOUND' };
                }

                const typeEl = matchedOption.querySelector('div[class*="duhSJu"]') || matchedOption.querySelector('div:last-child > div:last-child');
                const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';
                if (isVideo) {
                    if (!itemType.includes('video')) {
                        return { success: false, reason: 'EXPECTED_VIDEO_BUT_GOT_IMAGE', itemType };
                    }
                } else {
                    const isImg = itemType.includes('hình ảnh') || itemType.includes('image') || itemType.includes('ảnh') || itemType.includes('photo');
                    if (!isImg) {
                        return { success: false, reason: 'EXPECTED_IMAGE_BUT_GOT_VIDEO', itemType };
                    }
                }

                const imgEl = matchedOption.querySelector('img');
                if (!imgEl) {
                    return { success: false, reason: 'NO_THUMBNAIL' };
                }

                matchedOption.scrollIntoView({ block: 'nearest' });

                const optionRect = matchedOption.getBoundingClientRect();
                const imgRect = imgEl.getBoundingClientRect();

                const inScroller = (
                    optionRect.top >= scrollerRect.top - 1 &&
                    optionRect.bottom <= scrollerRect.bottom + 1 &&
                    optionRect.left >= scrollerRect.left - 1 &&
                    optionRect.right <= scrollerRect.right + 1
                );
                if (!inScroller) {
                    return { success: false, error: 'UNSAFE_GALLERY_CLICK_REJECTED', reason: 'OUTSIDE_SCROLLER', optionRect, scrollerRect };
                }

                // Tìm checkbox hoặc nút chọn trong matchedOption
                const checkbox = matchedOption.querySelector('[role="checkbox"]') ||
                    matchedOption.querySelector('[aria-label*="Chọn"], [aria-label*="Select"], [aria-label*="chọn"]') ||
                    matchedOption.querySelector('div[class*="checkbox"], div[class*="circle"], div[class*="check"]');

                let clickCoords = null;
                if (checkbox) {
                    const cbRect = checkbox.getBoundingClientRect();
                    if (cbRect.width > 0 && cbRect.height > 0) {
                        clickCoords = { x: cbRect.x + cbRect.width / 2, y: cbRect.y + cbRect.height / 2 };
                    }
                }

                if (!clickCoords) {
                    // Click vào góc trên bên trái của thumbnail với offset an toàn (16px) để tránh mở preview
                    clickCoords = { x: imgRect.x + 16, y: imgRect.y + 16 };
                }

                const insideScroller = (
                    clickCoords.x >= scrollerRect.left &&
                    clickCoords.x <= scrollerRect.right &&
                    clickCoords.y >= scrollerRect.top &&
                    clickCoords.y <= scrollerRect.bottom
                );
                const insideList = (
                    clickCoords.x >= listRect.left &&
                    clickCoords.x <= listRect.right &&
                    clickCoords.y >= listRect.top &&
                    clickCoords.y <= listRect.bottom
                );
                if (!insideScroller || !insideList) {
                    return { success: false, error: 'UNSAFE_GALLERY_CLICK_REJECTED', reason: 'CLICK_POINT_OUT_OF_BOUNDS', clickCoords, scrollerRect, listRect };
                }

                const ariaSelected = matchedOption.getAttribute('aria-selected') || 'false';
                const text = (matchedOption.innerText || matchedOption.textContent || '').trim();

                return {
                    success: true,
                    coords: clickCoords,
                    optionRect: { x: optionRect.x, y: optionRect.y, width: optionRect.width, height: optionRect.height },
                    imgRect: { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height },
                    scrollerRect,
                    listRect,
                    dataIndex,
                    itemType,
                    ariaSelected,
                    text
                };
            }
            return { success: false, reason: 'OPTION_NOT_FOUND' };
        }, { fileName, filePrefix, truncated15, truncated20, isVideo }).catch(err => ({ error: 'EVALUATE_FAILED', reason: err.message }));

        if (scanResultAfterSearch.error) {
            this.log(`[Gallery] Scan failed after search (reason: ${scanResultAfterSearch.reason}). Skipping gallery check to upload fresh.`);
            await clearSearchInput();
            return { success: false };
        }

        if (!scanResultAfterSearch.success) {
            this.log('[Gallery] No match after search. Clearing input and uploading fresh.');
            await clearSearchInput();
            return { success: false };
        }

        this.log(`[Gallery] 🔍 Click coords & option diagnostics (after search):
  - scrollerRect: ${JSON.stringify(scanResultAfterSearch.scrollerRect)}
  - listRect: ${JSON.stringify(scanResultAfterSearch.listRect)}
  - optionRect: ${JSON.stringify(scanResultAfterSearch.optionRect)}
  - imgRect: ${JSON.stringify(scanResultAfterSearch.imgRect)}
  - clickCoords: ${JSON.stringify(scanResultAfterSearch.coords)}
  - dataIndex: ${scanResultAfterSearch.dataIndex}
  - itemType: "${scanResultAfterSearch.itemType}"`);

        // Giả lập thời gian nhận thức & định vị (600ms - 1200ms) để giống người thật
        await this.sleep(600 + Math.floor(Math.random() * 600));
        this.log(`[Gallery] Match found after search. Clicking to select: ${scanResultAfterSearch.coords.x}, ${scanResultAfterSearch.coords.y}`);
        await this.humanClick(page, scanResultAfterSearch.coords.x, scanResultAfterSearch.coords.y);
        this.log('[Gallery] [gallery_item_selected] Đã click chọn thành công item lọc được sau khi search trong gallery.');
        await this.sleep(1200 + Math.random() * 800);

        await this.checkAndRecoverEditView(page);
        this.log('[Gallery] [gallery_item_selected] Selected existing image from gallery.');
        return { success: true, coords: scanResultAfterSearch.coords, scopeValidated: true, imgRect: scanResultAfterSearch.imgRect };
    }

    async waitForGalleryItemAndSelect(page, singleFile, timeoutMs = 25000, beforeState = { count: 0, items: [] }) {
        const fileName = path.basename(singleFile);
        const filePrefix = fileName.replace(/\.[^.]+$/, '');
        const truncated15 = filePrefix.substring(0, 15);
        const truncated20 = filePrefix.substring(0, 20);
        const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(singleFile);
        const deadline = Date.now() + timeoutMs;
        let selected = false;
        let selectedDetails = null;

        this.log(`[UploadSelect] Waiting for ${fileName} inside dialog options (isVideo: ${isVideo}, before count: ${beforeState?.count || 0})...`);

        // Đợi cấu trúc Virtuoso Gallery tải xong và ổn định trước khi quét item
        const selectStatus = await this.ensureVirtuosoGalleryLoaded(page, 10000);
        if (selectStatus === 'EMPTY_STATE') {
            this.log('[UploadSelect] Thư viện hiện tại đang trống (Sẽ tự động tải lên mới).');
        }

        while (Date.now() < deadline) {
            const scanResult = await page.evaluate(({ fileName, filePrefix, truncated15, truncated20, isVideo, beforeState }) => {
                const getVirtuosoGalleryScope = () => {
                    const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                    if (!dialog) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'DIALOG_NOT_FOUND' };

                    const scroller = dialog.querySelector('[data-testid="virtuoso-scroller"][data-virtuoso-scroller="true"]');
                    if (!scroller) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'SCROLLER_NOT_FOUND' };

                    const list = scroller.querySelector('[data-testid="virtuoso-item-list"]');
                    if (!list) return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'LIST_NOT_FOUND' };

                    const scrollerRect = scroller.getBoundingClientRect();
                    const listRect = list.getBoundingClientRect();

                    if (scroller.offsetParent === null || scrollerRect.width === 0 || scrollerRect.height === 0) {
                        return { success: false, error: 'GALLERY_SCOPE_NOT_FOUND', reason: 'SCROLLER_NOT_VISIBLE' };
                    }

                    return {
                        success: true,
                        dialog,
                        scroller,
                        list,
                        scrollerRect: { x: scrollerRect.x, y: scrollerRect.y, width: scrollerRect.width, height: scrollerRect.height, top: scrollerRect.top, bottom: scrollerRect.bottom, left: scrollerRect.left, right: scrollerRect.right },
                        listRect: { x: listRect.x, y: listRect.y, width: listRect.width, height: listRect.height, top: listRect.top, bottom: listRect.bottom, left: listRect.left, right: listRect.right }
                    };
                };

                const scope = getVirtuosoGalleryScope();
                if (!scope.success) {
                    return { success: false, error: scope.error, reason: scope.reason };
                }

                const list = scope.list;
                const scrollerRect = scope.scrollerRect;
                const listRect = scope.listRect;

                const allOptions = Array.from(list.querySelectorAll('[role="option"]'));
                const options = allOptions.filter(opt => {
                    const parent = opt.parentElement;
                    const grandparent = parent ? parent.parentElement : null;
                    const parentIndex = parent ? parent.getAttribute('data-index') : null;
                    const grandparentIndex = grandparent ? grandparent.getAttribute('data-index') : null;
                    return parentIndex !== null || grandparentIndex !== null;
                });

                let matchedOption = null;
                let matchIndex = -1;
                let method = 'option_text_match';

                for (let i = 0; i < options.length; i++) {
                    const opt = options[i];
                    if (opt.offsetParent === null) continue;

                    const nameEl = opt.querySelector('div[class*="jSAmQ"]') || opt.querySelector('div:last-child > div:first-child');
                    const typeEl = opt.querySelector('div[class*="duhSJu"]') || opt.querySelector('div:last-child > div:last-child');
                    const itemText = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim().toLowerCase() : '';
                    const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';

                    const isOptionVideo = itemType.includes('video');
                    if (isVideo && !isOptionVideo) continue;
                    if (!isVideo && isOptionVideo) continue;

                    const txt = itemText || (opt.innerText || opt.textContent || '').trim().toLowerCase();
                    const imgEl = opt.querySelector('img');

                    let textMatched = false;
                    let imgMatched = false;

                    textMatched = txt.length >= 4 && (
                        txt.includes(fileName.toLowerCase()) ||
                        txt.includes(filePrefix.toLowerCase()) ||
                        txt.includes(truncated15.toLowerCase()) ||
                        txt.includes(truncated20.toLowerCase())
                    );

                    if (imgEl) {
                        const alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                        const src = (imgEl.getAttribute('src') || '').toLowerCase();
                        imgMatched = alt.includes(fileName.toLowerCase()) || src.includes(fileName.toLowerCase()) ||
                            alt.includes(filePrefix.toLowerCase()) || src.includes(filePrefix.toLowerCase()) ||
                            alt.includes(truncated15.toLowerCase()) || src.includes(truncated15.toLowerCase()) ||
                            alt.includes(truncated20.toLowerCase()) || src.includes(truncated20.toLowerCase());

                        if (imgMatched) method = 'option_img_match';
                    }

                    if (textMatched || imgMatched) {
                        matchedOption = opt;
                        matchIndex = i;
                        break;
                    }
                }

                const beforeCount = beforeState?.count || 0;
                if (!matchedOption && beforeState && options.length > beforeCount) {
                    const beforeItems = beforeState?.items || [];
                    let clickedIndex = -1;

                    for (let i = 0; i < options.length; i++) {
                        const opt = options[i];

                        const typeEl = opt.querySelector('div[class*="duhSJu"]') || opt.querySelector('div:last-child > div:last-child');
                        const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';
                        const isOptionVideo = itemType.includes('video');
                        if (isVideo && !isOptionVideo) continue;
                        if (!isVideo && isOptionVideo) continue;

                        const parentIndex = opt.parentElement?.getAttribute('data-index');
                        const grandparentIndex = opt.parentElement?.parentElement?.getAttribute('data-index');
                        const idx = opt.getAttribute('data-index') || parentIndex || grandparentIndex || '';
                        const img = opt.querySelector('img');
                        const src = img ? img.src : '';

                        const wasPresent = beforeItems.some(b => {
                            if (src && b.src && src === b.src) return true;
                            if (idx && b.idx && idx === b.idx) return true;
                            return false;
                        });

                        if (!wasPresent) {
                            clickedIndex = i;
                            break;
                        }
                    }

                    if (clickedIndex === -1) {
                        for (let i = 0; i < options.length; i++) {
                            const opt = options[i];
                            const typeEl = opt.querySelector('div[class*="duhSJu"]') || opt.querySelector('div:last-child > div:last-child');
                            const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';
                            const isOptionVideo = itemType.includes('video');
                            if (isVideo && isOptionVideo) { clickedIndex = i; break; }
                            if (!isVideo && !isOptionVideo) { clickedIndex = i; break; }
                        }
                    }

                    if (clickedIndex !== -1) {
                        matchedOption = options[clickedIndex];
                        matchIndex = clickedIndex;
                        method = 'fallback_new_option';
                    }
                }

                if (matchedOption) {
                    const parent = matchedOption.parentElement;
                    const grandparent = parent ? parent.parentElement : null;
                    const parentIndex = parent ? parent.getAttribute('data-index') : null;
                    const grandparentIndex = grandparent ? grandparent.getAttribute('data-index') : null;
                    const dataIndex = parentIndex || grandparentIndex;
                    if (dataIndex === null) {
                        return { success: false, reason: 'NO_DATA_INDEX' };
                    }

                    if (matchedOption.getAttribute('role') !== 'option') {
                        return { success: false, reason: 'NOT_AN_OPTION' };
                    }

                    if (matchedOption.closest('[role="tablist"]') || matchedOption.closest('[role="tab"]') || matchedOption.closest('nav')) {
                        return { success: false, reason: 'TAB_ANCESTOR_FOUND' };
                    }

                    const typeEl = matchedOption.querySelector('div[class*="duhSJu"]') || matchedOption.querySelector('div:last-child > div:last-child');
                    const itemType = typeEl ? (typeEl.innerText || typeEl.textContent || '').trim().toLowerCase() : '';
                    if (isVideo) {
                        if (!itemType.includes('video')) {
                            return { success: false, reason: 'EXPECTED_VIDEO_BUT_GOT_IMAGE', itemType };
                        }
                    } else {
                        const isImg = itemType.includes('hình ảnh') || itemType.includes('image') || itemType.includes('ảnh') || itemType.includes('photo');
                        if (!isImg) {
                            return { success: false, reason: 'EXPECTED_IMAGE_BUT_GOT_VIDEO', itemType };
                        }
                    }

                    const imgEl = matchedOption.querySelector('img');
                    if (!imgEl) {
                        return { success: false, reason: 'NO_THUMBNAIL' };
                    }

                    matchedOption.scrollIntoView({ block: 'nearest' });

                    const optionRect = matchedOption.getBoundingClientRect();
                    const imgRect = imgEl.getBoundingClientRect();

                    const inScroller = (
                        optionRect.top >= scrollerRect.top - 1 &&
                        optionRect.bottom <= scrollerRect.bottom + 1 &&
                        optionRect.left >= scrollerRect.left - 1 &&
                        optionRect.right <= scrollerRect.right + 1
                    );
                    if (!inScroller) {
                        return { success: false, error: 'UNSAFE_GALLERY_CLICK_REJECTED', reason: 'OUTSIDE_SCROLLER', optionRect, scrollerRect };
                    }

                    // Tìm checkbox hoặc nút chọn trong matchedOption
                    const checkbox = matchedOption.querySelector('[role="checkbox"]') ||
                        matchedOption.querySelector('[aria-label*="Chọn"], [aria-label*="Select"], [aria-label*="chọn"]') ||
                        matchedOption.querySelector('div[class*="checkbox"], div[class*="circle"], div[class*="check"]');

                    let clickCoords = null;
                    if (checkbox) {
                        const cbRect = checkbox.getBoundingClientRect();
                        if (cbRect.width > 0 && cbRect.height > 0) {
                            clickCoords = { x: cbRect.x + cbRect.width / 2, y: cbRect.y + cbRect.height / 2 };
                        }
                    }

                    if (!clickCoords) {
                        // Click vào góc trên bên trái của thumbnail với offset an toàn (16px) để tránh mở preview
                        clickCoords = { x: imgRect.x + 16, y: imgRect.y + 16 };
                    }

                    const insideScroller = (
                        clickCoords.x >= scrollerRect.left &&
                        clickCoords.x <= scrollerRect.right &&
                        clickCoords.y >= scrollerRect.top &&
                        clickCoords.y <= scrollerRect.bottom
                    );
                    const insideList = (
                        clickCoords.x >= listRect.left &&
                        clickCoords.x <= listRect.right &&
                        clickCoords.y >= listRect.top &&
                        clickCoords.y <= listRect.bottom
                    );
                    if (!insideScroller || !insideList) {
                        return { success: false, error: 'UNSAFE_GALLERY_CLICK_REJECTED', reason: 'CLICK_POINT_OUT_OF_BOUNDS', clickCoords, scrollerRect, listRect };
                    }

                    const ariaSelected = matchedOption.getAttribute('aria-selected') || 'false';
                    const text = (matchedOption.innerText || matchedOption.textContent || '').trim();

                    return {
                        success: true,
                        method,
                        coords: clickCoords,
                        optionRect: { x: optionRect.x, y: optionRect.y, width: optionRect.width, height: optionRect.height },
                        imgRect: { x: imgRect.x, y: imgRect.y, width: imgRect.width, height: imgRect.height },
                        scrollerRect,
                        listRect,
                        dataIndex,
                        itemType,
                        ariaSelected,
                        text,
                        currentCount: options.length
                    };
                }

                return { success: false, reason: 'option_not_found_yet', currentCount: options.length };
            }, { fileName, filePrefix, truncated15, truncated20, beforeState });

            if (scanResult.error === 'GALLERY_SCOPE_NOT_FOUND') {
                this.log(`[UploadSelect] 🛑 Fail-Fast: GALLERY_SCOPE_NOT_FOUND (reason: ${scanResult.reason})`);
                throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: GALLERY_SCOPE_NOT_FOUND');
            }
            if (scanResult.error === 'UNSAFE_GALLERY_CLICK_REJECTED') {
                this.log(`[UploadSelect] 🛑 Fail-Fast: UNSAFE_GALLERY_CLICK_REJECTED (reason: ${scanResult.reason})`);
                throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: UNSAFE_GALLERY_CLICK_REJECTED');
            }

            if (scanResult.success && scanResult.coords) {
                this.log(`[UploadSelect] 🔍 Click coords & option diagnostics:
  - scrollerRect: ${JSON.stringify(scanResult.scrollerRect)}
  - listRect: ${JSON.stringify(scanResult.listRect)}
  - optionRect: ${JSON.stringify(scanResult.optionRect)}
  - imgRect: ${JSON.stringify(scanResult.imgRect)}
  - clickCoords: ${JSON.stringify(scanResult.coords)}
  - dataIndex: ${scanResult.dataIndex}
  - itemType: "${scanResult.itemType}"`);

                this.log(`[UploadSelect] Match found! Method: ${scanResult.method}. Option text: "${scanResult.text ? scanResult.text.substring(0, 40) : 'none'}". Click coordinates: ${scanResult.coords.x}, ${scanResult.coords.y}`);

                selectedDetails = {
                    method: scanResult.method,
                    coords: scanResult.coords,
                    text: scanResult.text,
                    ariaSelectedBefore: scanResult.ariaSelected,
                    scopeValidated: true,
                    imgRect: scanResult.imgRect
                };

                await this.humanClick(page, scanResult.coords.x, scanResult.coords.y, { humanConfig: { idle_between_actions: false } });
                this.log('[UploadSelect] [gallery_item_selected] Đã click chọn thành công item vừa upload lên gallery.');
                selected = true;
                break;
            } else {
                this.log(`[UploadSelect] Polling options... current count: ${scanResult.currentCount || 0} (before: ${beforeState?.count || 0}). Reason: ${scanResult.reason}`);
            }

            await this.sleep(2500 + Math.random() * 1000);
        }

        return { success: selected, details: selectedDetails };
    }

    async waitForUploadConfirmation(page, beforeCount, expectedCount, timeoutMs, fileName = '') {
        const start = Date.now();
        this.log(`[UploadVerify] Bat dau doi xac nhan upload cho ${fileName || (expectedCount + ' files')} trong ${timeoutMs / 1000}s...`);

        let uploadOk = false;
        let lastScanResult = null;

        while (Date.now() - start < timeoutMs) {
            const scan = await page.evaluate(() => {
                // 1. Quét attachment card thật sự
                const cards = Array.from(document.querySelectorAll('button[data-card-open][data-state]')).filter(card => {
                    const img = card.querySelector('img[src*="media.getMediaUrlRedirect"]');
                    if (!img) return false;
                    const hasCancelIcon = Array.from(card.querySelectorAll('i, span, div, button')).some(el => {
                        const txt = (el.textContent || el.innerText || '').trim().toLowerCase();
                        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                        const cls = (el.className || '').toLowerCase();
                        return txt === 'cancel' || txt === 'close' || txt === 'delete' || txt === 'remove' ||
                            aria.includes('cancel') || aria.includes('close') || aria.includes('delete') || aria.includes('remove') ||
                            cls.includes('cancel') || cls.includes('close') || cls.includes('delete') || cls.includes('remove');
                    });
                    return hasCancelIcon;
                });
                const cardCount = cards.length;

                // Scope broader input container area
                const ec = document.querySelector('form') ||
                    document.querySelector('[class*="input"]') ||
                    document.querySelector('[class*="bottom"]') ||
                    document.querySelector('[data-slate-editor="true"][role="textbox"]')?.closest('div[style*="border-radius"]') ||
                    document.querySelector('[data-slate-editor="true"][role="textbox"]')?.parentElement?.parentElement ||
                    document.body;

                // 2. Check direct media elements (fallback)
                const mediaEls = Array.from(ec.querySelectorAll('img, canvas, video')).filter(el => {
                    const r = el.getBoundingClientRect();
                    return r.width > 20 && r.height > 20 && el.offsetParent !== null && !el.src?.includes('avatar');
                });

                // 3. Check elements with background-image style (Google uses this sometimes for thumbs)
                const bgImageEls = Array.from(ec.querySelectorAll('div, span')).filter(el => {
                    const style = el.getAttribute('style') || '';
                    const r = el.getBoundingClientRect();
                    return style.includes('background-image') && style.includes('url(') && r.width > 20 && r.height > 20 && el.offsetParent !== null;
                });

                // 4. Check attachment delete/remove buttons (highly unique, directly represents attached card count)
                const deleteButtons = Array.from(ec.querySelectorAll('button, [role="button"]')).filter(btn => {
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    const txt = (btn.innerText || btn.textContent || '').toLowerCase();
                    const r = btn.getBoundingClientRect();
                    return (aria.includes('delete') || aria.includes('remove') || aria.includes('xóa') || aria.includes('x') || txt === 'close' || txt === 'cancel') && r.width > 5 && r.height > 5 && btn.offsetParent !== null;
                });

                // Compute overall attachments count by taking max of different signals (fallback)
                const composerMediaCount = Math.max(mediaEls.length, bgImageEls.length, deleteButtons.length);

                // Check dialog upload visibility
                const dialog = document.querySelector('[role="dialog"], div[class*="dialog"], div[class*="modal"]');
                const dialogVisible = !!dialog && dialog.getBoundingClientRect().width > 100 && dialog.getBoundingClientRect().height > 100 && dialog.offsetParent !== null;

                // Check progress indicator
                const texts = Array.from(ec.querySelectorAll('span, div, p'));
                const progressTexts = texts.map(el => el.innerText.trim()).filter(t => {
                    return t.endsWith('%') && t.length > 1 && t.length <= 4 && !isNaN(parseInt(t));
                });
                const hasProgress = progressTexts.length > 0;

                // Check dialog item count
                let dialogItemCount = 0;
                if (dialog) {
                    dialogItemCount = Array.from(dialog.querySelectorAll('img')).filter(img => img.getBoundingClientRect().width > 20).length;
                }

                return {
                    cardCount,
                    composerMediaCount,
                    dialogVisible,
                    dialogItemCount,
                    hasProgress,
                    progressTexts,
                    mediaCandidates: mediaEls.map(el => ({
                        tagName: el.tagName.toLowerCase(),
                        src: el.src ? el.src.substring(0, 80) : '',
                        visible: el.offsetParent !== null
                    }))
                };
            }).catch(err => {
                return {
                    cardCount: beforeCount,
                    composerMediaCount: beforeCount,
                    dialogVisible: false,
                    dialogItemCount: 0,
                    hasProgress: false,
                    progressTexts: [],
                    mediaCandidates: [],
                    error: err.message
                };
            });

            lastScanResult = scan;

            if (!scan.hasProgress) {
                // Ưu tiên 1: Đổi thành công qua Attachment Card thật sự
                if (scan.cardCount >= beforeCount + expectedCount) {
                    uploadOk = true;
                    this.log(`[UploadVerify] [attached_to_composer_by_card] Xac nhan thanh cong qua Attachment Card that! Card tang: ${beforeCount} -> ${scan.cardCount} (dat muc tieu >= ${beforeCount + expectedCount}).`);
                    break;
                }

                // Fallback 2: Đổi thành công qua media elements cũ
                if (scan.composerMediaCount >= beforeCount + expectedCount) {
                    uploadOk = true;
                    this.log(`[UploadVerify] Xac nhan thanh cong qua fallback cu! Media tang: ${beforeCount} -> ${scan.composerMediaCount}.`);
                    break;
                }
            }

            await this.sleep(2000 + Math.random() * 1000);
        }

        const currentUrl = await page.url();

        if (!uploadOk && lastScanResult) {
            this.log(`[UploadVerify] Timeout cho upload confirmation! Chi tiet quet cuoi cung:
  - beforeCount: ${beforeCount}
  - expectedCount: ${expectedCount}
  - cardCount: ${lastScanResult.cardCount}
  - composerMediaCount: ${lastScanResult.composerMediaCount}
  - dialogVisible: ${lastScanResult.dialogVisible}
  - dialogItemCount: ${lastScanResult.dialogItemCount}
  - matched filename: ${fileName}
  - progressText: ${lastScanResult.progressTexts.join(',') || 'none'}
  - current URL: ${currentUrl}
  - mediaCandidates: ${JSON.stringify(lastScanResult.mediaCandidates)}
  - error: ${lastScanResult.error || 'none'}`);

            const actualNewCards = lastScanResult.cardCount - beforeCount;
            const actualNewMedia = lastScanResult.composerMediaCount - beforeCount;
            if (actualNewCards > 0 || actualNewMedia > 0) {
                this.log(`[UploadVerify] Ho tro fallback: Mac du timeout nhung co card/media moi duoc attach. Tiep tuc.`);
                uploadOk = true;
            }
        }

        if (!uploadOk) {
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED');
        }

        return uploadOk;
    }

    async attachSelectedGalleryItem(page, selectionDetails, beforeCount, fileName) {
        this.log(`[AttachFlow] Bắt đầu quy trình attach đa lớp cho ${fileName}...`);

        const checkRecoverAndVerify = async (timeoutMs) => {
            // Tự động kiểm tra kẹt ở /edit/ và bấm Back để phục hồi
            await this.checkAndRecoverEditView(page);
            return await this.waitForUploadConfirmation(page, beforeCount, 1, timeoutMs, fileName);
        };

        // --- LỚP 1: Chờ tự động đính kèm ---
        this.log('[AttachFlow] Lớp 1: Đang chờ xem dialog tự đóng và ảnh tự động attach hay không...');
        try {
            // Tăng thời gian chờ tự nhiên lên 8 giây để mô phỏng con người kiên nhẫn chờ ảnh tải lên
            const attached = await checkRecoverAndVerify(8000);
            if (attached) {
                this.log('[AttachFlow] Lớp 1 thành công! Ảnh tự động attach.');
                return true;
            }
        } catch (e) {
            // continue
        }

        // --- LỚP 2: Kiểm tra trạng thái chọn → click confirm hoặc double click ---
        this.log('[AttachFlow] Lớp 2: Kiểm tra ảnh đang chọn trong dialog...');
        try {
            const galleryState = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                if (!dialog) return { hasDialog: false };

                const selectedOption = dialog.querySelector('[role="option"][aria-selected="true"]') ||
                    dialog.querySelector('[role="option"].selected') ||
                    dialog.querySelector('[role="option"][data-state="checked"]');

                let hasVisualSelection = false;
                if (!selectedOption) {
                    const options = Array.from(dialog.querySelectorAll('[role="option"]'));
                    hasVisualSelection = options.some(opt => {
                        const hasCheck = opt.querySelector('svg[class*="check"], [class*="check"], input:checked');
                        return !!hasCheck;
                    });
                }

                const isSelected = !!(selectedOption || hasVisualSelection);

                const firstOption = dialog.querySelector('[role="option"]');
                let firstItemCoords = null;
                if (firstOption) {
                    const r = firstOption.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        firstItemCoords = { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (firstOption.innerText || '').substring(0, 30) };
                    }
                }

                return { hasDialog: true, isSelected, firstItemCoords };
            });

            if (galleryState.hasDialog && galleryState.isSelected) {
                // Ảnh ĐANG CHỌN → click nút "Thêm vào câu lệnh"
                this.log('[AttachFlow] Lớp 2: Ảnh đang được chọn. Click nút confirm...');
                const clicked = await this._clickConfirmButtonInDialog(page);
                if (clicked) {
                    const attached = await checkRecoverAndVerify(5000);
                    if (attached) {
                        this.log('[AttachFlow] Lớp 2 thành công! Click confirm sau khi ảnh đã chọn.');
                        return true;
                    }
                }
            } else if (galleryState.hasDialog && !galleryState.isSelected && galleryState.firstItemCoords) {
                // Ảnh CHƯA CHỌN → double click gallery item
                this.log(`[AttachFlow] Lớp 2: Ảnh chưa chọn. Double click gallery item: "${galleryState.firstItemCoords.text}"`);
                await this.humanClick(page, galleryState.firstItemCoords.x, galleryState.firstItemCoords.y);
                await this.sleep(300 + Math.random() * 200);
                await this.humanClick(page, galleryState.firstItemCoords.x, galleryState.firstItemCoords.y);
                const attached = await checkRecoverAndVerify(5000);
                if (attached) {
                    this.log('[AttachFlow] Lớp 2 thành công! Double click gallery item.');
                    return true;
                }
                // Double click chỉ chọn → thử click confirm luôn
                const clicked = await this._clickConfirmButtonInDialog(page);
                if (clicked) {
                    const attached2 = await checkRecoverAndVerify(5000);
                    if (attached2) {
                        this.log('[AttachFlow] Lớp 2 thành công! Double click + confirm.');
                        return true;
                    }
                }
            }
        } catch (e) {
            // continue
        }

        // --- LỚP 3: Click nút confirm ---
        this.log('[AttachFlow] Lớp 3: Tìm và click các nút xác nhận chèn trong dialog...');
        try {
            const confirmBtnCoords = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                if (!dialog) return null;

                const btns = Array.from(dialog.querySelectorAll('button, [role="button"], a')).filter(btn => {
                    if (btn.closest('[role="tablist"]') || btn.closest('[role="tab"]') || btn.closest('nav')) {
                        return false;
                    }

                    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

                    const forbiddenTabTexts = [
                        'tất cả', 'hình ảnh', 'video', 'giọng nói', 'nhân vật', 'hình đại diện', 'tệp tải lên',
                        'all', 'images', 'voices', 'characters', 'avatars', 'uploads'
                    ];
                    for (const term of forbiddenTabTexts) {
                        if (txt === term || aria === term) {
                            return false;
                        }
                    }
                    return true;
                });

                const confirmTexts = ['thêm vào câu lệnh', 'add to prompt', 'chèn', 'insert', 'done', 'xong', 'use', 'select', 'ok', 'add', 'thêm', 'chọn'];
                const cancelTexts = ['cancel', 'close', 'back', 'search', 'quay lại', 'đóng', 'hủy'];

                for (const btn of btns) {
                    if (btn.offsetParent === null) continue;
                    const r = btn.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;

                    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

                    let isCancel = false;
                    for (const ct of cancelTexts) {
                        if (txt.includes(ct) || aria.includes(ct)) {
                            isCancel = true;
                            break;
                        }
                    }
                    if (isCancel) continue;

                    for (const ct of confirmTexts) {
                        if (txt.includes(ct) || aria.includes(ct)) {
                            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                        }
                    }
                }

                for (const btn of btns) {
                    if (btn.offsetParent === null) continue;
                    const r = btn.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;

                    const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

                    let isCancel = false;
                    for (const ct of cancelTexts) {
                        if (txt.includes(ct) || aria.includes(ct)) {
                            isCancel = true;
                            break;
                        }
                    }
                    if (isCancel) continue;

                    const cls = (btn.className || '').toLowerCase();
                    const isPrimary = cls.includes('primary') || cls.includes('submit') || cls.includes('confirm') || btn.getAttribute('type') === 'submit';
                    if (isPrimary) {
                        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                    }
                }
                return null;
            });

            if (confirmBtnCoords) {
                // Thêm độ trễ ngẫu nhiên từ 1.5s đến 3.5s (chậm 1s - 4s theo yêu cầu) để click mượt mà và giống người thật hơn
                const delayMs = 1500 + Math.floor(Math.random() * 2000);
                this.log(`[AttachFlow] Lớp 3: Tìm thấy nút xác nhận. Chờ ${delayMs}ms trước khi click...`);
                await this.sleep(delayMs);

                this.log(`[AttachFlow] Lớp 3: Click nút xác nhận tại tọa độ ${confirmBtnCoords.x}, ${confirmBtnCoords.y}...`);
                const confirmTexts = ['thêm vào câu lệnh', 'add to prompt', 'chèn', 'insert', 'done', 'xong', 'use', 'select', 'ok', 'add', 'thêm', 'chọn'];
                let clickedViaLocator = false;
                try {
                    const confirmBtn = page.locator('button, [role="button"], a').filter({
                        hasText: new RegExp(confirmTexts.join('|'), 'i')
                    }).last();
                    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await confirmBtn.click({ humanConfig: { idle_between_actions: true } });
                        clickedViaLocator = true;
                    }
                } catch (e) {
                    this.log(`[AttachFlow] Locator click warning: ${e.message}. Falling back to coordinates.`);
                }

                if (!clickedViaLocator) {
                    this.log(`[AttachFlow] Falling back: Click nút xác nhận tại tọa độ ${confirmBtnCoords.x}, ${confirmBtnCoords.y}...`);
                    await this.humanClick(page, confirmBtnCoords.x, confirmBtnCoords.y);
                }
                // Tăng thời gian chờ xác nhận cuối lên 6 giây để đảm bảo ảnh được ghi nhận đầy đủ vào Slate editor
                const attached = await checkRecoverAndVerify(6000);
                if (attached) {
                    this.log('[AttachFlow] Lớp 3 thành công! Đã chèn bằng nút xác nhận.');
                    return true;
                }
            } else {
                this.log('[AttachFlow] Lớp 3: Không tìm thấy nút xác nhận phù hợp.');
            }
        } catch (e) {
            this.log(`[AttachFlow] Gặp lỗi ở Lớp 3: ${e.message}`);
        }

        this.log('[AttachFlow] Thất bại! Cả 3 lớp giải pháp đều không đính kèm được ảnh.');
        return false;
    }

    async dumpDiagnosticsOnFailure(page, fileName, selectionDetails, beforeCount) {
        this.log(`[Diagnostic] 🛑 KHỞI CHẠY CHẨN ĐOÁN LỖI IMAGE_UPLOAD_VERIFY_FAILED CHO FILE: ${fileName}`);
        try {
            const dump = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                const dialogState = dialog ? {
                    visible: dialog.offsetParent !== null,
                    rect: dialog.getBoundingClientRect().toJSON()
                } : null;

                const dialogButtons = dialog ? Array.from(dialog.querySelectorAll('button, [role="button"], a')).map(btn => {
                    return {
                        text: (btn.innerText || btn.textContent || '').trim().substring(0, 50),
                        ariaLabel: btn.getAttribute('aria-label') || 'none',
                        role: btn.getAttribute('role') || 'none',
                        disabled: btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true',
                        rect: btn.getBoundingClientRect().toJSON()
                    };
                }) : [];

                const selectedOption = dialog ? Array.from(dialog.querySelectorAll('[role="option"]')).map(opt => {
                    const img = opt.querySelector('img');
                    return {
                        text: (opt.innerText || opt.textContent || '').trim().substring(0, 50),
                        ariaSelected: opt.getAttribute('aria-selected') || 'false',
                        imgAlt: img ? img.getAttribute('alt') || 'none' : 'none',
                        imgSrc: img ? img.getAttribute('src') || 'none' : 'none',
                        rect: opt.getBoundingClientRect().toJSON()
                    };
                }) : [];

                // Scan Slate Composer
                const composer = document.querySelector('[data-slate-editor="true"][role="textbox"]');
                const composerContainer = composer?.closest('form, div[role="search"], [class*="chat"], [class*="input"], [class*="bottom"], div[style*="border-radius"]');

                const composerState = composer ? {
                    visible: composer.offsetParent !== null,
                    rect: composer.getBoundingClientRect().toJSON(),
                    containerFound: !!composerContainer,
                    containerRect: composerContainer ? composerContainer.getBoundingClientRect().toJSON() : null,
                    images: Array.from(composerContainer ? composerContainer.querySelectorAll('img') : []).map(img => ({
                        src: img.src ? img.src.substring(0, 100) : '',
                        rect: img.getBoundingClientRect().toJSON()
                    }))
                } : null;

                return {
                    dialogState,
                    dialogButtons,
                    selectedOption,
                    composerState
                };
            }).catch(e => ({ error: e.message }));

            this.log(`[Diagnostic] Kết quả chẩn đoán lỗi đính kèm ảnh:
  - Dialog state: ${JSON.stringify(dump.dialogState)}
  - Dialog Buttons: ${JSON.stringify(dump.dialogButtons)}
  - Selected options attributes: ${JSON.stringify(dump.selectedOption)}
  - Composer State: ${JSON.stringify(dump.composerState)}
  - beforeCount: ${beforeCount}`);
        } catch (e) {
            this.log(`[Diagnostic] Không thể chạy chẩn đoán lỗi: ${e.message}`);
        }
    }

    async selectOrUploadSingleMediaFromOpenDialog(page, singleFile, options = {}) {
        const fileName = path.basename(singleFile);

        let galleryRes = await this.tryClickGalleryImage(page, singleFile);
        if (galleryRes && galleryRes.success) {
            return { success: true, source: 'gallery', details: galleryRes };
        }

        const dialogItemCountBefore = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"], div[class*="dialog"], div[class*="modal"]');
            if (!dialog) return { count: 0, items: [] };
            const listContainer = dialog.querySelector('[data-testid="virtuoso-item-list"]') || dialog;
            const options = Array.from(listContainer.querySelectorAll('[role="option"]'));
            return {
                count: options.length,
                items: options.map(opt => ({
                    idx: opt.getAttribute('data-index') || opt.parentElement?.getAttribute('data-index') || '',
                    src: opt.querySelector('img')?.src || '',
                    txt: (opt.innerText || opt.textContent || '').substring(0, 30)
                }))
            };
        }).catch(() => ({ count: 0, items: [] }));

        const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
            (async () => {
                await this.sleep(500);
                const uploadTexts = ['Upload image', 'upload', 'Tải hình ảnh lên', 'Tải nội dung nghe nhìn lên'];
                let clicked = false;

                for (const text of uploadTexts) {
                    const loc = page.locator('button, div[role="button"], span, a, div').filter({ hasText: new RegExp(text, 'i') }).last();
                    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
                        await loc.click({ humanConfig: { idle_between_actions: false } });
                        clicked = true;
                        break;
                    }
                }

                if (!clicked) {
                    this.log('[UploadCore] ⚠ Upload button not found via locator. Trying fallback evaluate...');
                    const btnHandle = await page.evaluateHandle(() => {
                        const items = Array.from(document.querySelectorAll('button, div[role="button"], span, a, div'));
                        for (let i = items.length - 1; i >= 0; i--) {
                            const el = items[i];
                            const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                            if (t.includes('upload') || t.includes('tải hình ảnh lên') || t.includes('tải nội dung nghe nhìn lên')) {
                                const r = el.getBoundingClientRect();
                                if (r.width > 0 && r.height > 0) return el;
                            }
                        }
                        return null;
                    });
                    const btn = btnHandle.asElement();
                    if (btn) {
                        await this.humanElClick(page, btn, { humanConfig: { idle_between_actions: false } });
                        clicked = true;
                    }
                }

                if (!clicked) throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Upload button not found');
            })()
        ]);

        if (!fileChooser) {
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: File chooser did not open');
        }

        // Giả lập Window bị mất tập trung (mở hộp thoại OS)
        await page.evaluate(() => {
            window.dispatchEvent(new Event('blur'));
            if (Object.defineProperty) {
                try {
                    Object.defineProperty(document, 'hasFocus', { get: () => false, configurable: true });
                } catch (e) { }
            }
        }).catch(() => { });

        const chooseDelay = 2500 + Math.floor(Math.random() * 2000);
        this.log(`[UploadCore] File Chooser opened. Giả lập chọn file trên OS trong ${chooseDelay}ms...`);
        await this.sleep(chooseDelay);

        this.log(`[UploadCore] Setting file: ${fileName}`);
        await fileChooser.setFiles([singleFile]);

        // Giả lập Window nhận lại tập trung (đóng hộp thoại OS)
        await page.evaluate(() => {
            window.dispatchEvent(new Event('focus'));
            if (Object.defineProperty) {
                try {
                    Object.defineProperty(document, 'hasFocus', { get: () => true, configurable: true });
                } catch (e) { }
            }
        }).catch(() => { });

        const selectionResult = await this.waitForGalleryItemAndSelect(page, singleFile, 25000, dialogItemCountBefore);
        if (!selectionResult.success) {
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Uploaded item did not appear in gallery or selection failed');
        }

        return { success: true, source: 'fresh_upload', details: selectionResult.details || selectionResult };
    }

    async uploadImages(page, rawImagePaths) {
        if (!rawImagePaths || !Array.isArray(rawImagePaths)) return;

        // 1. Filter valid paths
        const validPaths = [];
        for (const p of rawImagePaths) {
            if (p && typeof p === 'string') {
                const cleanPath = p.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '').replace(/^["']|["']$/g, '').trim();
                let exists = false;
                try { exists = fs.existsSync(cleanPath); } catch (e) { }
                if (cleanPath && exists) {
                    validPaths.push(cleanPath);
                } else if (cleanPath || p.trim()) {
                    this.log(`[Upload] Bo qua file anh khong ton tai: ${cleanPath || p}`);
                }
            }
        }

        // Dedupe again after cleaning (resolve + normalize for case-insensitive FS)
        const seenPaths = new Set();
        const pathsToUpload = [];
        for (const p of validPaths) {
            const resolved = path.resolve(p).toLowerCase();
            if (!seenPaths.has(resolved)) {
                seenPaths.add(resolved);
                pathsToUpload.push(p);
            }
        }
        if (pathsToUpload.length < validPaths.length) {
            this.log(`[Upload] Dedupe after resolve: ${validPaths.length} -> ${pathsToUpload.length} unique paths.`);
        }
        if (pathsToUpload.length === 0) {
            this.log('[Upload] Khong co anh hop le nao. Bo qua buoc upload.');
            return;
        }

        // In Veo3, each project/job starts empty. Even if an image was uploaded to the account earlier in this session,
        // we must still open the dialog and select/attach it from the gallery into the current project's editor.
        // Thus, we DO NOT filter out already-uploaded paths, but rather let the gallery-first search handle them instantly.
        const newPaths = pathsToUpload;

        this.log(`[Upload] Bat dau xu ly tai len ${newPaths.length} anh (gallery-first + per-file lock)...`);
        let totalUploaded = 0;

        // Helper: Find the (+) attach button coordinates
        const findPlusBtnCoords = async () => {
            return page.evaluate(() => {
                const getCenter = (el) => {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                    return null;
                };
                const editor = document.querySelector('.ql-editor, [data-slate-editor="true"], textarea, [contenteditable="true"]');
                if (editor) {
                    const container = editor.closest('form, div[role="search"], [class*="chat"], [class*="input"], [class*="bottom"], div[style*="border-radius"]') || editor.parentElement.parentElement.parentElement;
                    if (container) {
                        const btns = Array.from(container.querySelectorAll('button, [role="button"]'));
                        const explicitBtn = btns.find(b => {
                            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                            return aria.includes('upload') || aria.includes('attach') || aria.includes('add');
                        });
                        if (explicitBtn) return getCenter(explicitBtn);
                        const iconBtn = btns.find(b => {
                            const hasPlusSvg = b.querySelector('svg path[d*="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"]');
                            const hasGoogleIcon = Array.from(b.querySelectorAll('i, span, div.google-symbols')).some(el => {
                                const txt = el.textContent.trim();
                                return txt === 'add' || txt === 'attach_file' || txt === 'add_2' || txt === 'add_circle';
                            });
                            return hasPlusSvg || hasGoogleIcon;
                        });
                        if (iconBtn) return getCenter(iconBtn);
                        const editorRect = editor.getBoundingClientRect();
                        const leftBtn = btns.find(b => {
                            const r = b.getBoundingClientRect();
                            return r.width > 0 && r.x < editorRect.x && Math.abs(r.y - editorRect.y) < 60;
                        });
                        if (leftBtn) return getCenter(leftBtn);
                        const firstBtn = btns.find(b => getCenter(b) !== null);
                        if (firstBtn) return getCenter(firstBtn);
                    }
                }
                const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'));
                const attachBtn = allBtns.find(b => {
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    const isMatch = aria.includes('upload') || aria.includes('attach');
                    const hasIcon = Array.from(b.querySelectorAll('i, span, div.google-symbols')).some(el => {
                        const txt = el.textContent.trim();
                        return txt === 'add' || txt === 'attach_file' || txt === 'add_2' || txt === 'add_circle';
                    });
                    if (!isMatch && !hasIcon) return false;
                    const r = b.getBoundingClientRect();
                    return r.y > (window.innerHeight - 300);
                });
                if (attachBtn) return getCenter(attachBtn);
                return null;
            });
        };

        for (const singleFile of newPaths) {
            const resolvedPath = path.resolve(singleFile).toLowerCase();
            const fileName = path.basename(singleFile);
            const accountId = this.accountData.id || this.id;
            const lockKey = `${accountId}:${resolvedPath}`;

            this.log(`[Upload] Waiting for concurrency lock for: ${fileName}...`);
            const releaseLock = await acquireUploadLock(lockKey);
            try {
                // Fetch thumbCountBefore inside lock, right before manipulation (card-aware count)
                const thumbCountBefore = await page.evaluate(() => {
                    const cards = Array.from(document.querySelectorAll('button[data-card-open][data-state]')).filter(card => {
                        const img = card.querySelector('img[src*="media.getMediaUrlRedirect"]');
                        if (!img) return false;
                        const hasCancelIcon = Array.from(card.querySelectorAll('i, span, div, button')).some(el => {
                            const txt = (el.textContent || el.innerText || '').trim().toLowerCase();
                            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                            const cls = (el.className || '').toLowerCase();
                            return txt === 'cancel' || txt === 'close' || txt === 'delete' || txt === 'remove' ||
                                aria.includes('cancel') || aria.includes('close') || aria.includes('delete') || aria.includes('remove') ||
                                cls.includes('cancel') || cls.includes('close') || cls.includes('delete') || cls.includes('remove');
                        });
                        return hasCancelIcon;
                    });
                    if (cards.length > 0) return cards.length;

                    const ec = document.querySelector('[data-slate-editor="true"][role="textbox"]')?.closest('div[style*="border-radius"]') || document.querySelector('[data-slate-editor="true"][role="textbox"]')?.parentElement?.parentElement || document.body;
                    const mediaEls = Array.from(ec.querySelectorAll('img, canvas'));
                    return mediaEls.filter(el => {
                        const r = el.getBoundingClientRect();
                        return r.width > 20 && r.height > 20 && el.offsetParent !== null && !el.src?.includes('avatar');
                    }).length;
                }).catch(() => 0);

                const clickPlusAndOpenDialog = async () => {
                    // Polling retry: chờ DOM render đầy đủ trước khi tìm nút (+)
                    let plusCoords = null;
                    const maxAttempts = 5;
                    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                        // Đảm bảo editor container đã xuất hiện trước
                        if (attempt === 1) {
                            try {
                                await page.waitForSelector(
                                    '[data-slate-editor="true"][role="textbox"], .ql-editor, textarea, [contenteditable="true"]',
                                    { timeout: 8000, state: 'visible' }
                                );
                            } catch (e) {
                                this.log(`[Upload] Editor chưa visible sau 8s. Tiếp tục tìm nút (+)...`);
                            }
                        }
                        plusCoords = await findPlusBtnCoords();
                        if (plusCoords) break;
                        if (attempt < maxAttempts) {
                            this.log(`[Upload] Nút (+) chưa tìm thấy (lần ${attempt}/${maxAttempts}). Chờ 2s...`);
                            await this.sleep(2000 + Math.random() * 500);
                        }
                    }
                    if (!plusCoords) {
                        throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Cannot find upload plus button');
                    }
                    this.log(`[Upload] Click (+) button for ${fileName}...`);
                    await this.humanClick(page, plusCoords.x, plusCoords.y, { humanConfig: { idle_between_actions: false } });
                    await this.sleep(1200 + Math.random() * 800);
                };

                // Open dialog
                await clickPlusAndOpenDialog();

                const selected = await this.selectOrUploadSingleMediaFromOpenDialog(page, singleFile);
                this.log(`[Upload] Media selected via ${selected.source}. Attaching to composer...`);
                let attached = await this.attachSelectedGalleryItem(page, selected.details, thumbCountBefore, fileName);

                // If not attached yet, check if dialog auto-closed abnormally (Hụt chèn recovery)
                let dialogStillOpen = await page.locator('[role="dialog"]').isVisible().catch(() => false);
                if (!attached && !dialogStillOpen) {
                    this.log('[Upload] ⚠️ Dialog closed unexpectedly without attaching. Retrying attach flow...');
                    await clickPlusAndOpenDialog();
                    const selectedRetry = await this.selectOrUploadSingleMediaFromOpenDialog(page, singleFile);
                    attached = await this.attachSelectedGalleryItem(page, selectedRetry.details, thumbCountBefore, fileName);
                }

                if (attached) {
                    this._uploadedImages.add(resolvedPath);
                    totalUploaded++;
                } else {
                    // Diagnostic Dump on failure
                    await this.dumpDiagnosticsOnFailure(page, fileName, selected.details, thumbCountBefore);
                    throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Failed to attach image to composer');
                }
            } finally {
                releaseLock();
                // Close dialog if still open as cleanup
                const dialogStillOpen = await page.locator('[role="dialog"]').isVisible().catch(() => false);
                if (dialogStillOpen) {
                    this.log('[Upload] Closing dialog before next file...');
                    await page.keyboard.press('Escape');
                    await this.sleep(1000);
                }
            }
        }

        if (totalUploaded === 0) {
            this.log('[Upload] Khong upload duoc file nao. Bo qua.');
            return;
        }

        this.log(`[Upload] Da upload & attach ${totalUploaded}/${newPaths.length} file thanh cong.`);

        // Final check for policy errors
        const finalCheck = await page.evaluate(() => {
            const alerts = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"], [class*="snackbar"], snack-bar'));
            for (let a of alerts) {
                const t = (a.innerText || '').toLowerCase();
                if (a.offsetParent !== null && t.length > 5) {
                    if (t.includes('policy') || t.includes('could not upload') || t.includes('unsupported') ||
                        t.includes('file too large') || t.includes('upload failed') || t.includes('not allowed')) {
                        return { status: 'error', message: a.innerText.trim() };
                    }
                }
            }
            return { status: 'ok' };
        });

        if (finalCheck.status === 'error') {
            this.log(`[Upload] LOI CHINH SACH: "${finalCheck.message}"`);
            throw new Error('IMAGE_VIOLATION_OR_ERROR: ' + finalCheck.message);
        }

        // Kiểm tra xem đã có đủ card đính kèm thật sự chưa để tối ưu hóa thời gian chờ cứng
        const attachmentComplete = await page.evaluate(({ expectedCount }) => {
            const cards = Array.from(document.querySelectorAll('button[data-card-open][data-state]')).filter(card => {
                const img = card.querySelector('img[src*="media.getMediaUrlRedirect"]');
                if (!img) return false;
                const hasCancelIcon = Array.from(card.querySelectorAll('i, span, div, button')).some(el => {
                    const txt = (el.textContent || el.innerText || '').trim().toLowerCase();
                    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                    const cls = (el.className || '').toLowerCase();
                    return txt === 'cancel' || txt === 'close' || txt === 'delete' || txt === 'remove' ||
                        aria.includes('cancel') || aria.includes('close') || aria.includes('delete') || aria.includes('remove') ||
                        cls.includes('cancel') || cls.includes('close') || cls.includes('delete') || cls.includes('remove');
                });
                return hasCancelIcon;
            });
            // Kiểm tra xem có progress nào đang chạy không
            const ec = document.body;
            const texts = Array.from(ec.querySelectorAll('span, div, p'));
            const progressTexts = texts.map(el => el.innerText.trim()).filter(t => {
                return t.endsWith('%') && t.length > 1 && t.length <= 4 && !isNaN(parseInt(t));
            });
            const hasProgress = progressTexts.length > 0;
            return cards.length >= expectedCount && !hasProgress;
        }, { expectedCount: newPaths.length }).catch(() => false);

        if (attachmentComplete) {
            this.log(`[Upload] [attached_to_composer_by_card] Attachment card da duoc verify day du (${newPaths.length}/${newPaths.length}). Cho them 800-1200ms de on dinh truoc khi Submit.`);
            await this.sleep(800 + Math.random() * 400);
        } else {
            this.log('[Upload] Attachment card chua day du hoac dang upload. Cho 5-7s de Google xu ly tren server truoc khi Submit...');
            await this.sleep(5000 + Math.random() * 2000);
        }
    }

    async verifyI2VStartSlotHasImage(page) {
        return await page.evaluate(() => {
            // Khi ảnh đã gắn thành công vào slot "Bắt đầu", slot div[type="button"] chứa text "Bắt đầu"
            // sẽ BIẾN MẤT và được thay thế bằng card: button[data-card-open][data-state] > div > img[src*="media.getMediaUrlRedirect"]
            // Cách nhận biết: tìm container I2V (chứa slot "Kết thúc"/"End" hoặc nút swap_horiz) và kiểm tra card ảnh

            // Chiến lược 1: Slot "Bắt đầu" đã biến mất → tìm card ảnh trong vùng I2V frame container
            const endSlot = Array.from(document.querySelectorAll('div[type="button"]')).find(el => {
                const txt = (el.innerText || el.textContent || '').toLowerCase();
                return txt.includes('kết thúc') || txt.includes('end') || txt.includes('last frame');
            });

            if (endSlot) {
                // Tìm container cha chung chứa cả card ảnh và slot Kết thúc
                const container = endSlot.closest('div[class*="hpgSgT"]') ||
                    endSlot.parentElement?.parentElement ||
                    endSlot.parentElement;

                if (container) {
                    // Kiểm tra card ảnh đã gắn (cấu trúc: button[data-card-open] > div > img[src*="getMediaUrlRedirect"])
                    const cards = Array.from(container.querySelectorAll('button[data-card-open][data-state]'));
                    const hasImageCard = cards.some(card => {
                        const img = card.querySelector('img[src*="media.getMediaUrlRedirect"], img[src*="getMediaUrl"]');
                        if (!img) return false;
                        const r = img.getBoundingClientRect();
                        return r.width > 20 && r.height > 20;
                    });
                    if (hasImageCard) return true;

                    // Fallback: tìm bất kỳ img/canvas/video visible nào bên trong container (có kích thước thật)
                    const anyMedia = Array.from(container.querySelectorAll('img, canvas, video')).some(el => {
                        const r = el.getBoundingClientRect();
                        const src = el.src || '';
                        return r.width > 20 && r.height > 20 && el.offsetParent !== null && !src.includes('avatar');
                    });
                    if (anyMedia) return true;
                }
            }

            // Chiến lược 2: Slot "Bắt đầu" vẫn tồn tại nhưng đã chứa media bên trong (trạng thái mid-upload)
            const startSlots = Array.from(document.querySelectorAll('div[type="button"]')).filter(el => {
                const txt = (el.innerText || el.textContent || '').toLowerCase();
                return txt.includes('bắt đầu') || txt.includes('start') || txt.includes('first frame');
            });

            if (startSlots.length > 0) {
                // Slot vẫn còn hiển thị text → ảnh chưa gắn thành công
                return false;
            }

            // Chiến lược 3: Không tìm thấy cả slot "Bắt đầu" lẫn "Kết thúc" → tìm chung card ảnh I2V trên trang
            const globalCards = Array.from(document.querySelectorAll('button[data-card-open][data-state]'));
            return globalCards.some(card => {
                const img = card.querySelector('img[src*="media.getMediaUrlRedirect"], img[src*="getMediaUrl"]');
                if (!img) return false;
                const hasCancelIcon = Array.from(card.querySelectorAll('i, span')).some(el => {
                    const txt = (el.textContent || '').trim().toLowerCase();
                    return txt === 'cancel' || txt === 'close';
                });
                if (!hasCancelIcon) return false;
                const r = img.getBoundingClientRect();
                return r.width > 20 && r.height > 20;
            });
        }).catch(() => false);
    }

    async confirmI2VDialogSelection(page) {
        // === LỚP 1: Chờ dialog tự đóng và ảnh tự động attach ===
        this.log('[I2V-Confirm] Lớp 1: Chờ xem dialog tự đóng và ảnh tự attach...');
        await this.sleep(2000 + Math.random() * 1500);
        if (await this.verifyI2VStartSlotHasImage(page)) {
            this.log('[I2V-Confirm] Lớp 1 thành công! Ảnh đã tự động gắn vào slot.');
            return true;
        }

        // === LỚP 2: Kiểm tra trạng thái chọn trong gallery ===
        this.log('[I2V-Confirm] Lớp 2: Kiểm tra ảnh đang chọn trong dialog...');
        try {
            const galleryState = await page.evaluate(() => {
                const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                if (!dialog) return { hasDialog: false };

                // Kiểm tra xem có item nào đang được chọn (selected/highlighted) không
                const selectedOption = dialog.querySelector('[role="option"][aria-selected="true"]') ||
                    dialog.querySelector('[role="option"].selected') ||
                    dialog.querySelector('[role="option"][data-state="checked"]');

                // Nếu không có aria-selected, kiểm tra bằng visual (item có background khác, hoặc có checkbox checked)
                let hasVisualSelection = false;
                if (!selectedOption) {
                    const options = Array.from(dialog.querySelectorAll('[role="option"]'));
                    hasVisualSelection = options.some(opt => {
                        const style = window.getComputedStyle(opt);
                        // Item đang chọn thường có background đậm hơn hoặc có checkmark
                        const hasCheck = opt.querySelector('svg[class*="check"], [class*="check"], input:checked');
                        return !!hasCheck;
                    });
                }

                const isSelected = !!(selectedOption || hasVisualSelection);

                // Tìm item đầu tiên (dùng cho double click nếu chưa chọn)
                const firstOption = dialog.querySelector('[role="option"]');
                let firstItemCoords = null;
                if (firstOption) {
                    const r = firstOption.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        firstItemCoords = { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (firstOption.innerText || '').substring(0, 30) };
                    }
                }

                return { hasDialog: true, isSelected, firstItemCoords };
            });

            if (!galleryState.hasDialog) {
                this.log('[I2V-Confirm] Lớp 2: Không tìm thấy dialog.');
            } else if (galleryState.isSelected) {
                // Ảnh ĐANG CHỌN → click nút "Thêm vào câu lệnh"
                this.log('[I2V-Confirm] Lớp 2: Ảnh đang được chọn. Click nút "Thêm vào câu lệnh"...');
                const clicked = await this._clickConfirmButtonInDialog(page);
                if (clicked) {
                    await this.sleep(2500 + Math.random() * 1500);
                    if (await this.verifyI2VStartSlotHasImage(page)) {
                        this.log('[I2V-Confirm] Lớp 2 thành công! Đã chèn bằng nút xác nhận.');
                        return true;
                    }
                }
            } else if (galleryState.firstItemCoords) {
                // Ảnh CHƯA CHỌN → double click gallery item đầu tiên
                this.log(`[I2V-Confirm] Lớp 2: Ảnh chưa được chọn. Double click gallery item: "${galleryState.firstItemCoords.text}"`);
                await this.humanClick(page, galleryState.firstItemCoords.x, galleryState.firstItemCoords.y);
                await this.sleep(300 + Math.random() * 200);
                await this.humanClick(page, galleryState.firstItemCoords.x, galleryState.firstItemCoords.y);
                await this.sleep(2500 + Math.random() * 1500);
                if (await this.verifyI2VStartSlotHasImage(page)) {
                    this.log('[I2V-Confirm] Lớp 2 thành công! Đã chèn bằng double click.');
                    return true;
                }
                // Double click có thể chỉ chọn chứ không confirm → thử click nút confirm luôn
                const clicked = await this._clickConfirmButtonInDialog(page);
                if (clicked) {
                    await this.sleep(2500 + Math.random() * 1000);
                    if (await this.verifyI2VStartSlotHasImage(page)) {
                        this.log('[I2V-Confirm] Lớp 2 thành công! Double click + confirm button.');
                        return true;
                    }
                }
            }
        } catch (e) {
            this.log(`[I2V-Confirm] Lớp 2 lỗi: ${e.message}`);
        }

        // === LỚP 3: Fallback - Tìm và click nút xác nhận bằng evaluate toàn diện ===
        this.log('[I2V-Confirm] Lớp 3: Fallback tìm nút xác nhận...');
        try {
            const clicked = await this._clickConfirmButtonInDialog(page);
            if (clicked) {
                await this.sleep(2500 + Math.random() * 1500);
                if (await this.verifyI2VStartSlotHasImage(page)) {
                    this.log('[I2V-Confirm] Lớp 3 thành công!');
                    return true;
                }
            }
        } catch (e) {
            this.log(`[I2V-Confirm] Lớp 3 lỗi: ${e.message}`);
        }

        this.log('[I2V-Confirm] Thất bại! Không thể gắn ảnh vào slot Bắt đầu.');
        return false;
    }

    /**
     * Helper: Tìm và click nút xác nhận ("Thêm vào câu lệnh" / "Add to prompt") trong dialog.
     * Trả về true nếu đã click, false nếu không tìm thấy.
     */
    async _clickConfirmButtonInDialog(page) {
        const confirmBtnCoords = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
            if (!dialog) return null;

            const btns = Array.from(dialog.querySelectorAll('button, [role="button"], a')).filter(btn => {
                if (btn.closest('[role="tablist"]') || btn.closest('[role="tab"]') || btn.closest('nav')) return false;

                const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

                const forbiddenTabTexts = [
                    'tất cả', 'hình ảnh', 'video', 'giọng nói', 'nhân vật', 'hình đại diện', 'tệp tải lên',
                    'all', 'images', 'voices', 'characters', 'avatars', 'uploads'
                ];
                for (const term of forbiddenTabTexts) {
                    if (txt === term || aria === term) return false;
                }
                return true;
            });

            const confirmTexts = ['thêm vào câu lệnh', 'add to prompt', 'chèn', 'insert', 'done', 'xong', 'use', 'select', 'ok', 'add', 'thêm', 'chọn'];
            const cancelTexts = ['cancel', 'close', 'back', 'search', 'quay lại', 'đóng', 'hủy', 'upload'];

            for (const btn of btns) {
                if (btn.offsetParent === null) continue;
                const r = btn.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;

                const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

                let isCancel = false;
                for (const ct of cancelTexts) {
                    if (txt.includes(ct) || aria.includes(ct)) { isCancel = true; break; }
                }
                if (isCancel) continue;

                for (const ct of confirmTexts) {
                    if (txt.includes(ct) || aria.includes(ct)) {
                        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: txt.substring(0, 30) };
                    }
                }
            }

            // Fallback: tìm nút primary/submit
            for (const btn of btns) {
                if (btn.offsetParent === null) continue;
                const r = btn.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;

                const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();

                let isCancel = false;
                for (const ct of cancelTexts) {
                    if (txt.includes(ct) || aria.includes(ct)) { isCancel = true; break; }
                }
                if (isCancel) continue;

                const cls = (btn.className || '').toLowerCase();
                const isPrimary = cls.includes('primary') || cls.includes('submit') || cls.includes('confirm') || btn.getAttribute('type') === 'submit';
                if (isPrimary) {
                    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: txt.substring(0, 30) };
                }
            }
            return null;
        });

        if (!confirmBtnCoords) {
            this.log('[I2V-Confirm] Không tìm thấy nút xác nhận trong dialog.');
            return false;
        }

        const delayMs = 800 + Math.floor(Math.random() * 1200);
        this.log(`[I2V-Confirm] Tìm thấy nút "${confirmBtnCoords.text}". Chờ ${delayMs}ms...`);
        await this.sleep(delayMs);

        // Thử click qua locator trước
        let clickedViaLocator = false;
        try {
            const confirmTexts = ['thêm vào câu lệnh', 'add to prompt', 'chèn', 'insert', 'done', 'xong', 'use', 'select', 'ok', 'add', 'thêm', 'chọn'];
            const confirmBtn = page.locator('button, [role="button"], a').filter({
                hasText: new RegExp(confirmTexts.join('|'), 'i')
            }).last();
            if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await confirmBtn.click({ humanConfig: { idle_between_actions: false } });
                clickedViaLocator = true;
            }
        } catch (e) {
            this.log(`[I2V-Confirm] Locator click warning: ${e.message}`);
        }

        if (!clickedViaLocator) {
            this.log(`[I2V-Confirm] Fallback: Click tọa độ ${confirmBtnCoords.x}, ${confirmBtnCoords.y}...`);
            await this.humanClick(page, confirmBtnCoords.x, confirmBtnCoords.y);
        }

        return true;
    }

    async uploadI2VFrames(page, startImagePath) {
        this.log('[I2V] Bắt đầu quy trình upload I2V Frames (chỉ tải ảnh khung hình đầu)...');

        const cleanStart = startImagePath ? startImagePath.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E]/g, '').replace(/^["']|["']$/g, '').trim() : null;

        if (!cleanStart || !require('fs').existsSync(cleanStart)) {
            this.log(`[I2V] ⚠ LỖI: Ảnh khung hình đầu (Bắt đầu) không tồn tại hoặc rỗng: ${cleanStart}`);
            throw new Error(`IMAGE_START_FRAME_MISSING: Khung hình đầu bắt buộc cho I2V không tồn tại`);
        }

        this.log(`[I2V] Đang chuẩn bị tải ảnh khung hình đầu: ${cleanStart}`);
        const fileName = require('path').basename(cleanStart);

        // ============ BƯỚC 1: Tìm và click slot "Bắt đầu" ============
        let boxElement = null;
        for (let waitAttempt = 1; waitAttempt <= 5; waitAttempt++) {
            this.log(`[I2V] Tìm ô "Bắt đầu" (First frame) để tải lên (Lần ${waitAttempt}/5)...`);

            let slotLoc = page.locator('div[type="button"][aria-haspopup="dialog"]').filter({
                hasText: /Bắt đầu|Start|First frame/i
            }).first();

            if (await slotLoc.count() === 0) {
                slotLoc = page.locator('div[type="button"]').filter({
                    hasText: /Bắt đầu|Start|First frame/i
                }).first();
            }

            if (await slotLoc.count() > 0) {
                const isVisible = await slotLoc.isVisible().catch(() => false);
                if (isVisible) {
                    boxElement = await slotLoc.elementHandle().catch(() => null);
                    if (boxElement) {
                        this.log(`[I2V] Đã định vị thành công ô "Bắt đầu" qua locator.`);
                        break;
                    }
                }
            }

            const boxHandle = await page.evaluateHandle(() => {
                const buttons = Array.from(document.querySelectorAll('div[type="button"]')).filter(el => {
                    const txt = (el.innerText || '').toLowerCase();
                    return txt.includes('bắt đầu') || txt.includes('start') || txt.includes('first frame');
                });
                if (buttons.length > 0) return buttons[0];
                const classes = Array.from(document.querySelectorAll('div[type="button"].gjOFny'));
                if (classes.length > 0) return classes[0];
                return null;
            }).catch(() => null);

            if (boxHandle) {
                boxElement = boxHandle.asElement();
                if (boxElement) {
                    this.log(`[I2V] Định vị ô "Bắt đầu" qua fallback evaluate.`);
                    break;
                }
            }

            await this.sleep(1200 + Math.random() * 800);
        }

        if (!boxElement) {
            // ============ RECOVERY: Xác nhận menu model đã chọn đúng I2V chưa ============
            this.log('[I2V] ⚠ Không tìm thấy ô "Bắt đầu". Kiểm tra menu model có đúng chế độ I2V (VIDEO_FRAMES)...');

            const isI2VActive = await page.evaluate(() => {
                // Kiểm tra tab VIDEO_FRAMES đang active
                const videoFramesTab = document.querySelector('button[aria-controls$="-content-VIDEO_FRAMES"]');
                if (videoFramesTab) {
                    const isSelected = videoFramesTab.getAttribute('data-state') === 'active' ||
                        videoFramesTab.getAttribute('aria-selected') === 'true';
                    return { found: true, active: isSelected, text: (videoFramesTab.textContent || '').trim() };
                }
                // Fallback: kiểm tra có slot "Bắt đầu" / "Kết thúc" ở đâu trên page
                const allText = document.body.innerText || '';
                const hasStartSlot = /bắt đầu|start|first frame/i.test(allText);
                const hasEndSlot = /kết thúc|end|last frame/i.test(allText);
                return { found: false, active: false, hasStartSlot, hasEndSlot };
            }).catch(() => ({ found: false, active: false }));

            this.log(`[I2V] Trạng thái I2V tab: ${JSON.stringify(isI2VActive)}`);

            if (!isI2VActive.active) {
                this.log('[I2V] ❌ Menu CHƯA ở chế độ I2V! Đang chạy lại setupCreateMenu...');
                // Reset cached settings để force setupCreateMenu chạy lại
                this._lastAppliedSettings = null;
                try {
                    // Cần job data → lấy từ context hiện tại (job được truyền vào pipeline)
                    // setupCreateMenu sẽ click: VIDEO tab → VIDEO_FRAMES sub-tab → chọn model
                    const recoveryJob = this._currentJob || { TYPE_VIDEO: 'I2V', settings: this._currentJobSettings || {} };
                    await this.setupCreateMenu(page, recoveryJob);
                    this.log('[I2V] Đã chạy lại setupCreateMenu. Thử tìm slot "Bắt đầu" lần nữa...');

                    // Retry tìm slot thêm 3 lần
                    for (let retryAttempt = 1; retryAttempt <= 3; retryAttempt++) {
                        await this.sleep(1500 + Math.random() * 1000);
                        const slotLoc = page.locator('div[type="button"]').filter({
                            hasText: /Bắt đầu|Start|First frame/i
                        }).first();
                        if (await slotLoc.count() > 0 && await slotLoc.isVisible().catch(() => false)) {
                            boxElement = await slotLoc.elementHandle().catch(() => null);
                            if (boxElement) {
                                this.log(`[I2V] ✅ Tìm thấy ô "Bắt đầu" sau khi fix menu (lần ${retryAttempt}).`);
                                break;
                            }
                        }
                        this.log(`[I2V] Retry ${retryAttempt}/3: Slot vẫn chưa xuất hiện...`);
                    }
                } catch (menuErr) {
                    this.log(`[I2V] Lỗi khi chạy lại setupCreateMenu: ${menuErr.message}`);
                }
            }

            if (!boxElement) {
                this.log('[I2V] ⚠ LỖI: Không tìm thấy ô "Bắt đầu" trên giao diện sau tất cả các cơ chế phục hồi.');
                throw new Error('SLOT_START_FRAME_NOT_FOUND: Không tìm thấy ô Bắt đầu để upload ảnh');
            }
        }

        // ============ BƯỚC 2: Click slot "Bắt đầu" để mở dialog ============
        this.log('[I2V] Đã định vị ô "Bắt đầu". Thực hiện click...');
        let clickedViaLocator = false;
        try {
            const slotLoc = page.locator('div[type="button"]').filter({
                hasText: /Bắt đầu|Start|First frame/i
            }).first();

            if (await slotLoc.count() > 0 && await slotLoc.isVisible().catch(() => false)) {
                this.log('[I2V] Click ô "Bắt đầu" trực tiếp bằng locator...');
                await slotLoc.click({ humanConfig: { idle_between_actions: false } });
                clickedViaLocator = true;
            }
        } catch (locErr) {
            this.log(`[I2V] Locator slot click failed: ${locErr.message}, trying coordinate fallback...`);
        }

        if (!clickedViaLocator) {
            this.log('[I2V] Bấm ô "Bắt đầu" qua tọa độ ElementHandle fallback...');
            await page.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), boxElement).catch(() => { });
            await this.sleep(500);
            await this.humanElClick(page, boxElement);
        }
        await this.sleep(1200 + Math.random() * 800);

        // Verify dialog mở
        const dialogOpened = await page.locator('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]').last().isVisible({ timeout: 4000 }).catch(() => false);
        if (!dialogOpened) {
            this.log('[I2V] ⚠ Cảnh báo: Dialog/menu chọn ảnh chưa mở. Click lại lần nữa...');
            if (clickedViaLocator) {
                const slotLoc = page.locator('div[type="button"]').filter({
                    hasText: /Bắt đầu|Start|First frame/i
                }).first();
                await slotLoc.click({ humanConfig: { idle_between_actions: false } }).catch(() => { });
            } else {
                await this.humanElClick(page, boxElement);
            }
            await this.sleep(1000);
        }

        // ============ BƯỚC 3: Thử tìm ảnh trong Gallery trước ============
        this.log('[I2V] Dialog đã mở. Thử tìm ảnh trong gallery...');
        let uploaded = false;

        let galleryRes = await this.tryClickGalleryImage(page, cleanStart);
        if (galleryRes && galleryRes.success) {
            this.log('[I2V] Tìm thấy ảnh trong gallery! Đang xác nhận vào slot...');
            uploaded = await this.confirmI2VDialogSelection(page);
        }

        // ============ BƯỚC 4: Nếu gallery thất bại → Upload trực tiếp ============
        if (!uploaded) {
            this.log('[I2V] Ảnh chưa có trong gallery hoặc chưa confirm được. Tiến hành upload trực tiếp...');

            // 4a: Upload file qua file chooser
            const [fileChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
                (async () => {
                    await this.sleep(500);
                    const uploadTexts = ['Tải nội dung nghe nhìn lên', 'Upload image', 'upload', 'Tải hình ảnh lên'];
                    let clicked = false;

                    for (const text of uploadTexts) {
                        const loc = page.locator('button, div[role="button"], span, a, div').filter({ hasText: new RegExp(text, 'i') }).last();
                        if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
                            await loc.click({ humanConfig: { idle_between_actions: false } });
                            clicked = true;
                            this.log(`[I2V] Click nút upload: "${text}"`);
                            break;
                        }
                    }

                    if (!clicked) {
                        this.log('[I2V] ⚠ Upload button not found via locator. Trying fallback evaluate...');
                        const btnHandle = await page.evaluateHandle(() => {
                            const items = Array.from(document.querySelectorAll('button, div[role="button"], span, a, div'));
                            for (let i = items.length - 1; i >= 0; i--) {
                                const el = items[i];
                                const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                                if (t.includes('upload') || t.includes('tải hình ảnh lên') || t.includes('tải nội dung nghe nhìn lên')) {
                                    const r = el.getBoundingClientRect();
                                    if (r.width > 0 && r.height > 0) return el;
                                }
                            }
                            return null;
                        });
                        const btn = btnHandle.asElement();
                        if (btn) {
                            await this.humanElClick(page, btn, { humanConfig: { idle_between_actions: false } });
                            clicked = true;
                        }
                    }

                    if (!clicked) throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Upload button not found');
                })()
            ]);

            if (!fileChooser) {
                throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: File chooser did not open for I2V');
            }

            // Giả lập Window bị mất tập trung (mở hộp thoại OS)
            await page.evaluate(() => {
                window.dispatchEvent(new Event('blur'));
                try { Object.defineProperty(document, 'hasFocus', { get: () => false, configurable: true }); } catch (e) { }
            }).catch(() => { });

            const chooseDelay = 2500 + Math.floor(Math.random() * 2000);
            this.log(`[I2V] File Chooser opened. Giả lập chọn file trên OS trong ${chooseDelay}ms...`);
            await this.sleep(chooseDelay);

            this.log(`[I2V] Setting file: ${fileName}`);
            await fileChooser.setFiles([cleanStart]);

            // Giả lập Window nhận lại tập trung
            await page.evaluate(() => {
                window.dispatchEvent(new Event('focus'));
                try { Object.defineProperty(document, 'hasFocus', { get: () => true, configurable: true }); } catch (e) { }
            }).catch(() => { });

            // 4b: Chờ ảnh upload xong và xuất hiện trong gallery (3-6 giây)
            this.log('[I2V] Chờ ảnh upload hoàn tất và xuất hiện trong gallery (3-6s)...');
            await this.sleep(3000 + Math.random() * 3000);

            // 4c: Thử tìm lại ảnh vừa upload trong gallery và click chọn
            galleryRes = await this.tryClickGalleryImage(page, cleanStart);
            if (galleryRes && galleryRes.success) {
                this.log('[I2V] Tìm thấy ảnh vừa upload trong gallery! Đang xác nhận...');
                uploaded = await this.confirmI2VDialogSelection(page);
            }

            // 4d: Nếu tryClickGalleryImage vẫn thất bại → click item đầu tiên trong gallery (ảnh mới nhất)
            if (!uploaded) {
                this.log('[I2V] Không tìm thấy ảnh bằng tên file. Thử click gallery item đầu tiên (ảnh mới nhất)...');
                try {
                    const clickedFirstItem = await page.evaluate(() => {
                        const dialog = document.querySelector('[role="dialog"]') || document.querySelector('div[class*="dialog"]') || document.querySelector('div[class*="modal"]');
                        if (!dialog) return null;
                        const options = Array.from(dialog.querySelectorAll('[role="option"]'));
                        if (options.length === 0) return null;
                        const first = options[0];
                        const r = first.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (first.innerText || '').substring(0, 30) };
                        }
                        return null;
                    });

                    if (clickedFirstItem) {
                        this.log(`[I2V] Click gallery item đầu tiên: "${clickedFirstItem.text}"`);
                        await this.humanClick(page, clickedFirstItem.x, clickedFirstItem.y);
                        await this.sleep(1500 + Math.random() * 1000);
                        uploaded = await this.confirmI2VDialogSelection(page);
                    }
                } catch (e) {
                    this.log(`[I2V] Fallback click gallery item lỗi: ${e.message}`);
                }
            }

            // 4e: Fallback cuối cùng: kiểm tra xem ảnh đã tự động gắn vào slot chưa (một số trường hợp tự attach)
            if (!uploaded) {
                this.log('[I2V] Kiểm tra xem ảnh đã tự attach sau upload...');
                await this.sleep(2000);
                uploaded = await this.verifyI2VStartSlotHasImage(page);
                if (uploaded) {
                    this.log('[I2V] Ảnh đã tự động gắn vào slot sau upload!');
                }
            }
        }

        if (!uploaded) {
            this.log('[I2V] ⚠ LỖI: Toàn bộ quy trình I2V upload thất bại.');
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: I2V image could not be attached to Start slot');
        }

        // ============ BƯỚC 5: Đóng dialog nếu còn mở ============
        const dialogStillOpen = await page.locator('[role="dialog"], div[class*="dialog"], div[class*="modal"]').last()
            .isVisible({ timeout: 1000 })
            .catch(() => false);

        if (dialogStillOpen) {
            await page.keyboard.press('Escape');
            await this.sleep(800);
        }

        if (!(await this.verifyI2VStartSlotHasImage(page))) {
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: I2V Start slot missing image after upload flow');
        }

        this.log('[I2V] ✅ Upload I2V Frame thành công! Cho 4-6s để hoàn tất xử lý UI...');
        await this.sleep(4000 + Math.random() * 2000);
    }


    async close(isRestarting = false) {
        if (!isRestarting) {
            this.isOffline = true;
            this.isBusy = false;
        }

        // Tab mode (shared browser): only close our tab, not the whole browser
        if (this._isTabMode) {
            this.log('Closing tab (shared browser mode)...');
            try {
                if (this.page && !this.page.isClosed()) await this.page.close().catch(() => { });
                if (this.blankPage && !this.blankPage.isClosed()) await this.blankPage.close().catch(() => { });
            } catch (e) { }
            this.page = null;
            this.blankPage = null;
            return;
        }

        this.log('Closing browser instance...');
        let browserPid = null;
        if (this.browser) {
            try {
                const childProcess = typeof this.browser.process === 'function' ? this.browser.process() : null;
                if (childProcess) {
                    browserPid = childProcess.pid;
                }
            } catch (e) { }

            try {
                await this.browser.close();
            } catch (e) { }

            this.browser = null;
            this.page = null;
            this.blankPage = null;
        }

        // Force kill the browser's process tree by PID
        if (browserPid) {
            try {
                require('child_process').execSync(`taskkill /F /T /PID ${browserPid}`, { stdio: 'ignore' });
            } catch (killErr) { }
        }

        // Fallback: Kill zombie browser processes by profile path (catches orphans when PID is lost)
        if (this.profilePath) {
            try {
                const { execSync } = require('child_process');
                const escaped = this.profilePath.replace(/\\/g, '\\\\');
                const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | Select-Object -ExpandProperty ProcessId`;
                const pidOutput = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf-8', timeout: 8000 }).trim();
                if (pidOutput) {
                    const pids = pidOutput.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
                    for (const pid of pids) {
                        try {
                            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 3000 });
                        } catch (e) { /* already exited */ }
                    }
                }
            } catch (e) { /* non-fatal: no matching processes */ }
        }
    }



    async processJob(jobData, outputDir) {
        this.isBusy = true;
        // IN ĐỂ DEBUG PAYLOAD GỬI TỪ BACKEND
        this.log(`[DEBUG PAYLOAD] Job: ${jobData.JOB_ID} | TYPE: ${jobData.TYPE_VIDEO} | StartImage: ${jobData.IMAGE_PATH || 'NULL'} | EndImage: ${jobData.IMAGE_PATH_2 || 'NULL'} | PromptLen: ${(jobData.PROMPT || '').length} chars`);
        // Pipeline is now orchestrated externally by orchestrator.cjs
        // This method is kept for backward compatibility — orchestrator calls _internalProcessJob directly
        await this._internalProcessJob(jobData, outputDir);
    }

    // ==========================================
    // PIPELINE: 9-STEP EXECUTION
    // ==========================================

    async ensureBrowserReady() {
        this.log('[Worker] 🤖 STEP 1/9: Kiểm tra trạng thái trình duyệt 🤖');

        if (this.needsProactiveReset) {
            this.log('[Worker] 🔄 Proactive 50-command reset triggered. Resetting browser before next job...');
            this.needsProactiveReset = false;
            this.successfulGenerations = 0;
            if (this.browser) {
                await this.close(true);
            }
            this.deepCleanProfile();
            this.isOffline = false;
            this.settingsApplied = false;
            this._lastAppliedSettings = null;
            this._uploadedImages.clear();
        }

        if (!this.page) await this.launch();
        if (!this.page) {
            throw new Error('BROWSER_LAUNCH_FAILED: this.page is null after launch()');
        }
        let page = this.page;

        let url = await page.url();
        let navigated = false;
        let retries = 0;

        // Support any language locale or direct project url without navigating away
        while (!(url.includes('labs.google/fx') && url.includes('/tools/flow')) && retries < 3) {
            if (url.includes('accounts.google.com') || url.includes('signin') || url.includes('AccountChooser')) {
                this.log('[STEP 1] Redirected to Google login page. Breaking navigation loop to handle session restoration.');
                break;
            }
            this.log(`[STEP 1] Navigating to Veo3 (Attempt ${retries + 1}/3)...`);
            try {
                await page.goto('https://labs.google/fx/vi/tools/flow', { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForFunction('document.readyState === "complete" || document.readyState === "interactive"', { timeout: 10000 });
                navigated = true;
            } catch (navErr) {
                this.log(`[STEP 1] Navigation error: ${navErr.message}`);
            }
            await this.sleep(800 + Math.random() * 700);
            url = await page.url();
            retries++;
        }

        const isLoggedIn = await page.evaluate(() => {
            const html = document.documentElement.innerHTML.toLowerCase();
            const hasSignInBtn = html.includes('sign in with google') || html.includes('đăng nhập bằng google') || html.includes('sign in to continue');
            const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
            const hasNewProject = textNodes.some(el => {
                if (!el.textContent) return false;
                const t = el.textContent.trim().toLowerCase();
                return t.includes('dự án mới') ||
                    t.includes('new project') ||
                    t.includes('create new project');
            });
            const hasPrompt = !!document.querySelector('[data-slate-editor="true"][role="textbox"], textarea[aria-label*="Prompt"]');
            const inProject = window.location.href.includes('/flow/project/');
            return !hasSignInBtn && (hasNewProject || hasPrompt || inProject);
        }).catch(() => false);

        let shouldRestoreSession = false;
        if (!isLoggedIn) {
            if (url.includes('/flow/project/') && !url.includes('signin')) {
                this.log('[STEP 1] isLoggedIn returned false but URL is a project. Assuming false negative.');
            } else {
                shouldRestoreSession = true;
            }
        }
        if (url.includes('accounts.google.com') || url.includes('signin') || url.includes('AccountChooser')) {
            shouldRestoreSession = true;
        }

        if (shouldRestoreSession) {
            this.log('[STEP 1] Login redirect detected. Attempting to restore session...');
            await this.handleLoginWait();
            page = this.page; // Refresh page reference in case of browser restart during login restoration
            if (!page) {
                this.log(`[STEP 1] this.page is null after handleLoginWait(). Trying to recover page from browser contexts... (profile: ${this.profilePath})`);
                if (this.browser) {
                    const contexts = this.browser.contexts();
                    if (contexts.length > 0) {
                        const pages = contexts[0].pages();
                        if (pages.length > 0) {
                            this.page = pages[0];
                            page = this.page;
                            this.log('[STEP 1] Recovered page from browser context successfully.');
                        }
                    }
                }
            }
            if (!page) {
                this.log(`[STEP 1] page is still null. Performing clean browser restart... (profile: ${this.profilePath})`);
                await this.close(true).catch(() => { });
                await this.launch();
                page = this.page;
            }
            if (!page) {
                throw new Error(`BROWSER_LAUNCH_FAILED: this.page is null after clean restart in ensureBrowserReady() for profile: ${this.profilePath}`);
            }
            let currentUrl = await page.url();
            if (!currentUrl.includes('labs.google')) {
                throw new Error(`[STEP 1] Timeout or failure during session restore for profile: ${this.profilePath}`);
            } else {
                this.log('[STEP 1] ✓ Login restored successfully. Resuming job...');
                url = currentUrl;
                navigated = true;
            }
        }
        return page;
    }

    async clickCreateWithFlow(page) {
        this.log('[Worker] 🤖 STEP 2/9: Click Create with Flow 🤖');
        const currentUrl = await page.url();
        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin') || currentUrl.includes('AccountChooser')) {
            throw new Error('[STEP 2] Redirected to Google Login before clicking intro CTA.');
        }

        try {
            // Try up to 3 times to find and click the intro CTA button
            for (let attempt = 0; attempt < 3; attempt++) {
                const loopUrl = await page.url();
                if (loopUrl.includes('accounts.google.com') || loopUrl.includes('signin') || loopUrl.includes('AccountChooser')) {
                    throw new Error('[STEP 2] Redirected to Google Login during CTA click attempts.');
                }

                const btnCoords = await page.evaluate(() => {
                    // Check if we're already in workspace (has editor or "New Project" button)
                    const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                    if (hasEditor) return null; // Already in workspace, no need to click

                    const allElements = document.querySelectorAll('button, [role="button"], a, div, span');
                    for (const el of allElements) {
                        if (!el.textContent) continue;
                        const t = el.textContent.trim();
                        const tl = t.toLowerCase();
                        // Match exact or near-exact button text (not parent containers with lots of text)
                        if ((tl === 'create with google flow' || tl === 'tạo bằng google flow' ||
                            tl === 'create with flow' || tl === 'tạo bằng flow') && t.length < 50) {
                            const r = el.getBoundingClientRect();
                            if (r.width > 30 && r.height > 15 && r.width < 500) {
                                return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                            }
                        }
                    }
                    return null;
                }).catch(() => null);

                if (!btnCoords) {
                    // Xác nhận xem có đang ở workspace sẵn hay không
                    const inWorkspace = await page.evaluate(() => {
                        return !!document.querySelector('[data-slate-editor="true"][role="textbox"]') ||
                            Array.from(document.querySelectorAll('div, span, button')).some(el => el.textContent && (el.textContent.includes('Dự án mới') || el.textContent.includes('New Project')));
                    }).catch(() => false);

                    if (inWorkspace) {
                        this.log('[STEP 2] Already in workspace, skipping CTA click.');
                        return;
                    }
                    throw new Error('[STEP 2] CTA button not found and not in workspace.');
                }

                this.log(`[STEP 2] Found intro CTA at (${Math.round(btnCoords.x)}, ${Math.round(btnCoords.y)}). Clicking...`);
                // Add small random offset for humanization
                await this.humanClick(
                    page,
                    btnCoords.x + (Math.random() * 6 - 3),
                    btnCoords.y + (Math.random() * 4 - 2)
                );
                await this.sleep(1500 + Math.random() * 1000);

                // Verify click worked
                const stillOnIntro = await page.evaluate(() => {
                    const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                    const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
                    const hasNewProject = textNodes.some(el => {
                        if (!el.textContent) return false;
                        const t = el.textContent.trim().toLowerCase();
                        return t === 'dự án mới' || t === 'new project';
                    });
                    return !hasEditor && !hasNewProject;
                }).catch(() => true);

                if (!stillOnIntro) {
                    this.log('[STEP 2] ✓ Successfully entered workspace!');
                    return;
                }
                this.log(`[STEP 2] Still on intro page after click (attempt ${attempt + 1}/3). Retrying...`);
                await this.sleep(1000 + Math.random() * 500);
            }
            throw new Error('[STEP 2] Could not click intro button after 3 attempts.');
        } catch (e) {
            this.log('[STEP 2] Execution failed: ' + e.message);
            throw e;
        }
    }

    async clickNewProject(page) {
        this.log('[Worker] 🤖 STEP 3/9: Click New Project 🤖');
        const currentUrl = await page.url();
        if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin') || currentUrl.includes('AccountChooser')) {
            throw new Error('[STEP 3] Redirected to Google Login before clicking New Project.');
        }

        // --- NEW OPTIMIZED FLOW: STAY IN ACTIVE PROJECT ---
        const inActiveProject = currentUrl.match(/\/flow\/project\/[^\/]+/);
        if (inActiveProject) {
            this.log('[STEP 3] Already in an active project. Skipping New Project click to reuse project scope and gallery!');
            return;
        }

        // If we are actually creating a new project, we MUST clear the uploaded images cache
        this._uploadedImages.clear();

        // Scroll to bottom — "Dự án mới" button is at the end of the gallery
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => { });
        await this.sleep(500 + Math.random() * 500);

        try {
            // CloakBrowser humanize: locator.click() auto-scrolls + aims naturally
            const newProjBtn = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /Dự án mới|New project/i }).last();
            await newProjBtn.waitFor({ state: 'visible', timeout: 5000 });
            this.log('[STEP 3] Clicking "Dự án mới" via locator...');
            await newProjBtn.click();
            await this.sleep(1000 + Math.random() * 500);
        } catch (e) {
            const loopUrl = await page.url();
            if (loopUrl.includes('accounts.google.com') || loopUrl.includes('signin') || loopUrl.includes('AccountChooser')) {
                throw new Error('[STEP 3] Redirected to Google Login during New Project click.');
            }
            const inProject = loopUrl.match(/\/flow\/project\/[^\/]+/);
            if (inProject) {
                this.log('[STEP 3] Already in project, skipping New Project click.');
                return;
            }
            throw new Error(`[STEP 3] Failed to click New Project: ${e.message}`);
        }
    }

    async verifyProjectPage(page) {
        this.log('[Worker] 🤖 STEP 4/9: Verify Project Page 🤖');
        let currentUrl = await page.url();
        let retry = 0;
        while (!currentUrl.match(/\/flow\/project\/[^\/]+/) && retry < 3) {
            this.log(`[STEP 4] URL not matching project format (Attempt ${retry + 1}/3): ${currentUrl}`);

            // Google Sign-In redirect check during STEP 4
            if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin') || currentUrl.includes('AccountChooser')) {
                this.log('[STEP 4] Redirected to Google Login (Session Expired/Invalid). Attempting to restore session...');
                await this.handleLoginWait();

                // User requirement: "cứ tạo project mới và tải ảnh lên lại"
                this.log('[STEP 4] Session recovery complete. Clearing uploaded images cache to ensure clean re-upload...');
                this._uploadedImages.clear();

                page = this.page; // Update local reference in case of browser restart
                this.log('[STEP 4] Re-executing STEP 3: Click New Project...');
                await this.clickNewProject(page);
                currentUrl = await page.url();
                retry = 0; // Reset retries
                continue;
            }

            await this.sleep(1000 + Math.random() * 500);
            currentUrl = await page.url();
            retry++;
        }

        if (!currentUrl.match(/\/flow\/project\/[^\/]+/)) {
            throw new Error('[STEP 4] Failed to reach a valid project page.');
        }
        this.log('[STEP 4] ✓ Confirmed Project Page URL: ' + currentUrl);
    }

    /**
     * STEP 4.5: Close Agent chat panel + toggle off "Tác nhân" button.
     * 
     * When a new project opens, Google Flow may auto-open an Agent chat panel on the right side
     * ("Phiên không có tiêu đề"), blocking the normal prompt box and settings menu.
     * 
     * Sub-step A: Detect and close the Agent chat panel via its "Đóng" (close icon) button.
     * Sub-step B: Toggle off the "Tác nhân" button (aria-pressed="true" → "false").
     * 
     * Only after both steps is the normal prompt interface restored with settings menu visible.
     */
    async checkAndToggleAgentButton(page) {
        this.log('[Worker] 🤖 STEP 4.5/9: Close Agent Panel & Toggle Agent Button 🤖');

        // Let the page transition and DOM settle down (wait for panel to mount/slide in)
        await this.sleep(3000);

        // ============ SUB-STEP A: Close Agent Chat Panel ============
        try {
            this.log('[STEP 4.5a] Checking for Agent chat panel...');
            let clicked = false;
            for (let attempt = 1; attempt <= 10; attempt++) {
                const chatPanelClose = await page.evaluate(() => {
                    const isVisible = (el) => {
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    };

                    // Strategy 1: Find header with "Phiên không có tiêu đề" / "Untitled session"
                    // and search for a close button within its parent containers
                    const headers = Array.from(document.querySelectorAll('h2, h3, div, span'));
                    for (const h of headers) {
                        const txt = (h.textContent || '').trim().toLowerCase();
                        if (txt.includes('phiên không có tiêu đề') || txt.includes('untitled session')) {
                            let container = h.parentElement;
                            // Search up to 4 levels of ancestors for a close button
                            for (let i = 0; i < 4 && container; i++) {
                                const buttons = Array.from(container.querySelectorAll('button'));
                                for (const btn of buttons) {
                                    if (!isVisible(btn)) continue;
                                    const icon = btn.querySelector('i.google-symbols, .google-symbols');
                                    const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
                                    const span = btn.querySelector('span');
                                    const spanText = span ? (span.textContent || '').trim().toLowerCase() : '';

                                    if (iconText === 'close' || ['đóng', 'close'].includes(spanText)) {
                                        const r = btn.getBoundingClientRect();
                                        return {
                                            found: true,
                                            x: r.x + r.width / 2,
                                            y: r.y + r.height / 2,
                                            method: 'header-ancestor-match'
                                        };
                                    }
                                }
                                container = container.parentElement;
                            }
                        }
                    }

                    // Strategy 2: Fallback - look for any button on the right side of the screen
                    // with a close icon or "close"/"đóng" text inside an agent/session panel context
                    const allBtns = Array.from(document.querySelectorAll('button'));
                    for (const btn of allBtns) {
                        if (!isVisible(btn)) continue;

                        const r = btn.getBoundingClientRect();

                        // Must be on the right side of the screen
                        const isRightSide = r.x > window.innerWidth * 0.5;
                        if (!isRightSide) continue;

                        // Children Structure Check
                        const icon = btn.querySelector('i.google-symbols, .google-symbols');
                        const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';

                        const span = btn.querySelector('span');
                        const spanText = span ? (span.textContent || '').trim().toLowerCase() : '';

                        const hasCloseIcon = iconText === 'close';
                        const hasDongText = ['đóng', 'close'].includes(spanText);
                        const isWrongMenuBtn = iconText === 'menu' || spanText.includes('nhật ký') || spanText.includes('history');

                        if (isWrongMenuBtn || (!hasCloseIcon && !hasDongText)) continue;

                        // Parent Panel Context check
                        let parent = btn.parentElement;
                        for (let i = 0; i < 5 && parent; i++) {
                            const parentText = (parent.innerText || '').toLowerCase();
                            const isAgentOrChatPanel = parentText.includes('phiên không có tiêu đề') ||
                                parentText.includes('untitled session') ||
                                parentText.includes('chào') ||
                                parentText.includes('bạn muốn làm gì') ||
                                parentText.includes('tác nhân') ||
                                parentText.includes('agent') ||
                                parentText.includes('what do you want to do');

                            if (isAgentOrChatPanel) {
                                return {
                                    found: true,
                                    x: r.x + r.width / 2,
                                    y: r.y + r.height / 2,
                                    method: 'right-side-agent-panel-context'
                                };
                            }
                            parent = parent.parentElement;
                        }
                    }
                    return { found: false };
                }).catch(() => ({ found: false }));

                if (chatPanelClose.found) {
                    this.log(`[STEP 4.5a] [Attempt ${attempt}/10] ⚠ Agent chat panel detected (${chatPanelClose.method}). Clicking close button...`);
                    await this.humanClick(page, chatPanelClose.x, chatPanelClose.y);
                    await this.sleep(2000 + Math.random() * 500);
                    this.log('[STEP 4.5a] ✓ Agent chat panel closed.');
                    clicked = true;
                    break;
                }
                await this.sleep(1000);
            }

            if (!clicked) {
                this.log('[STEP 4.5a] No agent chat panel detected or failed to locate close button after 10 attempts. Skipping.');
            }
        } catch (e) {
            this.log(`[STEP 4.5a] Warning: Chat panel close failed: ${e.message}. Continuing...`);
        }

        // ============ SUB-STEP B: Toggle off "Tác nhân" (Agent) button ============
        try {
            this.log('[STEP 4.5b] Checking for Agent toggle button...');
            const agentBtnInfo = await page.evaluate(() => {
                const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                };

                // Find all buttons that could be the Agent toggle button
                const allBtns = Array.from(document.querySelectorAll('button'));
                for (const btn of allBtns) {
                    if (!isVisible(btn)) continue;

                    const r = btn.getBoundingClientRect();

                    // Check classes
                    const classes = Array.from(btn.classList);
                    const hasClassSc5922 = classes.some(c => c.includes('sc-59223abb-3') || c.includes('sc-59223abb'));

                    // Check inner text or structured children
                    const spanContent = btn.querySelector('span.content, span');
                    const spanText = spanContent ? (spanContent.textContent || '').trim().toLowerCase() : '';
                    const hasAgentText = ['tác nhân', 'agent'].includes(spanText);

                    // Fallback text checks
                    const fullText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                    const isAgentText = fullText.includes('tác nhân') || fullText.includes('agent') ||
                        ariaLabel.includes('tác nhân') || ariaLabel.includes('agent');

                    // If matches classes or contains Agent text
                    const matchesUserDOM = hasClassSc5922 || hasAgentText || isAgentText;

                    if (matchesUserDOM) {
                        const pressedAttr = btn.getAttribute('aria-pressed') || btn.getAttribute('aria-selected');
                        const dataState = btn.getAttribute('data-state');
                        const isPressed = pressedAttr === 'true' || dataState === 'active' || dataState === 'on';

                        return {
                            found: true,
                            pressed: isPressed,
                            x: r.x + r.width / 2,
                            y: r.y + r.height / 2,
                            text: fullText.substring(0, 30),
                            method: hasClassSc5922 ? 'precise-class' : 'text-match'
                        };
                    }
                }
                return { found: false };
            }).catch(() => ({ found: false }));

            if (!agentBtnInfo.found) {
                this.log('[STEP 4.5b] Agent toggle button not found on page. Skipping.');
                return;
            }

            if (agentBtnInfo.pressed) {
                this.log(`[STEP 4.5b] ⚠ Agent button "${agentBtnInfo.text}" is ACTIVE. Clicking to deactivate...`);
                await this.humanClick(page, agentBtnInfo.x, agentBtnInfo.y);
                await this.sleep(1000 + Math.random() * 500);

                // NẾU MÀN HÌNH XUẤT HIỆN POPUP OFF/ON (UI MỚI CỦA GOOGLE LABS)
                this.log(`[STEP 4.5b] Checking for Off/On popup...`);
                try {
                    const offBtn = page.locator('button[role="tab"][aria-label="Off"], button[role="tab"]:has-text("Off")').last();
                    if (await offBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
                        this.log(`[STEP 4.5b] Found "Off" tab in popup. Clicking it...`);
                        await offBtn.click({ force: true, delay: 100 + Math.random() * 100 });
                        await this.sleep(500 + Math.random() * 500);
                    }
                } catch(e) {}

                // Verify toggle succeeded
                const verifyState = await page.evaluate(() => {
                    const isVisible = (el) => {
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden') return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    };
                    const allBtns = Array.from(document.querySelectorAll('button'));
                    for (const btn of allBtns) {
                        if (!isVisible(btn)) continue;
                        const classes = Array.from(btn.classList);
                        const hasClassSc5922 = classes.some(c => c.includes('sc-59223abb-3') || c.includes('sc-59223abb'));

                        const spanContent = btn.querySelector('span.content, span');
                        const spanText = spanContent ? (spanContent.textContent || '').trim().toLowerCase() : '';
                        const hasAgentText = ['tác nhân', 'agent'].includes(spanText);

                        const fullText = (btn.innerText || btn.textContent || '').trim().toLowerCase();
                        if (hasClassSc5922 || hasAgentText || fullText.includes('tác nhân') || fullText.includes('agent')) {
                            const pressedAttr = btn.getAttribute('aria-pressed') || btn.getAttribute('aria-selected');
                            const dataState = btn.getAttribute('data-state');
                            return (pressedAttr === 'true' || dataState === 'active' || dataState === 'on') ? 'true' : 'false';
                        }
                    }
                    return null;
                }).catch(() => null);

                if (verifyState === 'false') {
                    this.log('[STEP 4.5b] ✓ Agent button successfully deactivated.');
                } else if (verifyState === null) {
                    this.log('[STEP 4.5b] ✓ Agent button no longer found after click (removed from DOM). OK.');
                } else {
                    this.log(`[STEP 4.5b] ⚠ Agent button state after click: active="${verifyState}". May need manual check.`);
                }
            } else {
                this.log(`[STEP 4.5b] ✓ Agent button "${agentBtnInfo.text}" is already OFF. No action needed.`);
            }
        } catch (e) {
            this.log(`[STEP 4.5b] Warning: Agent button toggle failed: ${e.message}. Continuing pipeline...`);
        }
    }

    async setupViewMode(page) {
        this.log('[Worker] 🤖 STEP 5/9: Setup View Mode 🤖');

        // Skip entirely if already applied (no waiting needed)
        if (this.viewModeApplied) {
            this.log('[STEP 5] View mode already applied.');
            return;
        }

        // Overall timeout guard: max 10 seconds for entire STEP 5
        const step5Timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('STEP 5 overall timeout (10s)')), 10000)
        );

        try {
            await Promise.race([step5Timeout, (async () => {
                // Wait for settings gear icon as page readiness signal
                try {
                    await page.locator('i.google-symbols').filter({ hasText: 'settings_2' }).first()
                        .waitFor({ state: 'visible', timeout: 5000 });
                } catch (e) {
                    this.log('[STEP 5] Warning: Settings gear icon not visible yet, proceeding anyway...');
                }

                this.log('[STEP 5] Applying view mode settings...');

                // Helper: toggle a setting row — strict 2s timeout per setting
                const toggleSetting = async (labelTextList, desiredState) => {
                    try {
                        let label = null;
                        for (const text of (Array.isArray(labelTextList) ? labelTextList : [labelTextList])) {
                            const found = page.locator('span').filter({ hasText: text }).first();
                            if (await found.isVisible({ timeout: 500 }).catch(() => false)) {
                                label = found;
                                break;
                            }
                        }
                        if (!label) return;
                        const parentRow = label.locator('xpath=ancestor::div[contains(@class,"lhAacX") or contains(@class,"sc-") or button[aria-controls]]').first();
                        const suffix = desiredState ? '-content-true' : '-content-false';
                        const targetLabel = desiredState ? 'Đang bật' : 'Đang tắt';
                        const btn = parentRow.locator(`button.flow_tab_slider_trigger[aria-controls$="${suffix}"], button.flow_tab_slider_trigger[aria-label="${targetLabel}"], button.flow_tab_slider_trigger[aria-label="${desiredState ? 'On' : 'Off'}"]`).first();
                        const state = await btn.getAttribute('data-state', { timeout: 1000 }).catch(() => '');
                        if (state !== 'active') {
                            this.log(`[STEP 5] Setting "${labelTextList}" → ${desiredState ? 'True' : 'False'}`);
                            await btn.click({ timeout: 1500 });
                            await this.sleep(150);
                        }
                    } catch (e) { /* setting not found or timeout — skip */ }
                };

                // 1. Open settings panel — click gear icon (settings_2)
                const settingsBtn = page.locator('button:has(i.google-symbols:has-text("settings_2")), button:has-text("Xem chế độ cài đặt lưới ô"), button[aria-label*="cài đặt"], button[aria-label*="settings"], i.google-symbols:has-text("settings_2")').first();
                if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    this.log('[STEP 5] Opening settings panel...');
                    await settingsBtn.click({ timeout: 2000 });
                    await this.sleep(400);

                    // 2. Click "Batch" / "Theo nhóm" mode button (if available)
                    try {
                        const batchBtn = page.locator('button[aria-controls$="-content-batch"], button[aria-controls$="-content-grid"], button[aria-label="Theo nhóm"], button[aria-label="Batch"], button[aria-label="Lưới"], button[aria-label="Grid"], button:has-text("Lưới")').first();
                        if (await batchBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
                            this.log('[STEP 5] Clicking batch mode...');
                            await batchBtn.click({ timeout: 1500 });
                            await this.sleep(150);
                        }
                    } catch (e) { /* batch not found */ }

                    // 3. Set grid size to S (Small)
                    try {
                        const smallTab = page.locator('button[aria-controls$="-content-SMALL"], button[aria-label="Nhỏ"], button.flow_tab_slider_trigger').filter({ hasText: /^(S|Nhỏ)$/i }).first();
                        if (await smallTab.isVisible({ timeout: 1000 }).catch(() => false)) {
                            const isActive = await smallTab.getAttribute('data-state', { timeout: 1000 }).catch(() => '');
                            if (isActive !== 'active') {
                                this.log('[STEP 5] Setting grid to Small...');
                                await smallTab.click({ timeout: 1500 });
                                await this.sleep(150);
                            }
                        }
                    } catch (e) { /* grid tab not found */ }

                    // 4. Sound off (Âm thanh khi di chuột → Đang tắt)
                    await toggleSetting(['Hover sounds', 'Âm thanh khi di chuột'], false);

                    // 5. Return silent videos → Đang bật (if config says so)
                    const cfg = this.automationService && this.automationService.configManager
                        ? this.automationService.configManager.getConfig() : {};
                    await toggleSetting(['Return silent videos', 'Trả về video không âm thanh', 'Trả về video không tiếng'], cfg.returnSilent !== false);

                    // 6. Show cell info → Đang bật (Hiện thông tin chi tiết về ô)
                    await toggleSetting(['Show cell details', 'Hiện thông tin chi tiết về ô'], true);

                    // 7. Clear prompt after send → Đang tắt (Xoá câu lệnh sau khi gửi)
                    await toggleSetting(['Clear prompt after sending', 'Xoá câu lệnh sau khi gửi'], false);

                    // Close settings panel
                    await page.keyboard.press('Escape');
                    await this.sleep(150);
                } else {
                    this.log('[STEP 5] Settings gear icon not found, skipping...');
                }

                this.viewModeApplied = true;
                this.log('[STEP 5] ✓ View mode applied.');
            })()]);
        } catch (err) {
            this.viewModeApplied = true; // Mark as applied to avoid retrying next time
            this.log(`[STEP 5] Warning: ${err.message}. Marked as applied to avoid re-attempt.`);
        }
    }

    /**
     * STEP 6: Setup Create Menu & Model Selection
     * Configures: Video/Image tab → Model dropdown → Aspect ratio → Count
     * Model names MUST match exactly with FE settings.vue select options
     */
    async setupCreateMenu(page, job) {
        this.log('[Worker] 🤖 STEP 6/9: Setup Menu & Model 🤖');

        const isVideoJob = job.TYPE_VIDEO === 'T2V' || job.TYPE_VIDEO === 'I2V' || job.TYPE_VIDEO === 'IN2V';
        const jobConfig = job.settings || (this.automationService && this.automationService.configManager ? this.automationService.configManager.getConfig() : {});

        // Resolve target settings — prioritize nested imgSettings/videoSettings (from adapter), fallback to flat config
        let targetModelName, targetCount, targetRatio;
        if (isVideoJob) {
            const vs = jobConfig.videoSettings || {};
            targetModelName = vs.model || jobConfig.videoModel || 'Veo 3.1 - Lite [Lower Priority]';
            targetCount = vs.count || jobConfig.videoCount || '1';
            targetRatio = vs.ratio || jobConfig.videoRatio || '16:9';
        } else {
            const is = jobConfig.imgSettings || {};
            targetModelName = is.model || jobConfig.imgModel || 'Nano Banana Pro';
            targetCount = is.count || jobConfig.imgCount || '1';
            targetRatio = is.ratio || jobConfig.imgRatio || '16:9';
        }
        // Normalize count: strip 'x'/'X' prefix/suffix → pure digit string
        targetCount = String(targetCount).replace(/[xX]/g, '').trim() || '1';

        // --- NEW: Check if settings are already applied and match target ---
        if (this._lastAppliedSettings &&
            this._lastAppliedSettings.model === targetModelName &&
            this._lastAppliedSettings.ratio === targetRatio &&
            this._lastAppliedSettings.count === targetCount &&
            this._lastAppliedSettings.type === job.TYPE_VIDEO) {

            // Với I2V: cache có thể sai nếu UI đã đổi mode → verify DOM thực tế
            if (job.TYPE_VIDEO === 'I2V') {
                const i2vTabActive = await page.evaluate(() => {
                    const tab = document.querySelector('button[aria-controls$="-content-VIDEO_FRAMES"]');
                    if (!tab) return false;
                    return tab.getAttribute('data-state') === 'active' || tab.getAttribute('aria-selected') === 'true';
                }).catch(() => false);

                if (!i2vTabActive) {
                    this.log('[STEP 6] ⚠ Cache nói I2V đã apply nhưng DOM không có VIDEO_FRAMES active. Chạy lại setupCreateMenu...');
                    this._lastAppliedSettings = null;
                    // Fall through — không return, tiếp tục chạy setup bên dưới
                } else {
                    this.log('[STEP 6] Model and menu configuration already matches target settings (DOM verified). Skipping menu setup!');
                    return;
                }
            } else {
                this.log('[STEP 6] Model and menu configuration already matches target settings. Skipping menu setup to save time!');
                return;
            }
        }

        // --- Coordinates map — stable aria-controls$ selectors from Radix UI ---
        const coords = {
            modes: {
                'T2V': { type: 'selector', value: 'button[role="tab"]:has-text("Video"), button[aria-controls$="-content-VIDEO"]' },
                'IN2V': { type: 'selector', value: 'button[role="tab"]:has-text("Video"), button[aria-controls$="-content-VIDEO"]' },
                'I2V': { type: 'selector', value: 'button[role="tab"]:has-text("Video"), button[aria-controls$="-content-VIDEO"]' },
                'IMG': { type: 'selector', value: 'button[role="tab"]:has-text("Image"), button[aria-controls$="-content-IMAGE"]' },
                trigger_create_menu: { type: 'custom', value: 'pill_button' }
            },
            subModes: {
                'IN2V': { type: 'selector', value: 'button[aria-controls$="-content-VIDEO_REFERENCES"]' },
                'I2V': { type: 'selector', value: 'button[aria-controls$="-content-VIDEO_FRAMES"]' }
            },
            ratioVideo: {
                'Ngang': { type: 'selector', value: 'button[aria-controls$="-content-LANDSCAPE"]' },
                'Dọc': { type: 'selector', value: 'button[aria-controls$="-content-PORTRAIT"]' }
            },
            ratioImage: {
                '16:9': { type: 'selector', value: 'button[aria-controls$="-content-LANDSCAPE"]' },
                '9:16': { type: 'selector', value: 'button[aria-controls$="-content-PORTRAIT"]' },
                '1:1': { type: 'selector', value: 'button[aria-controls$="-content-SQUARE"]' },
                '4:3': { type: 'selector', value: 'button[aria-controls$="-content-LANDSCAPE_4_3"]' },
                '3:4': { type: 'selector', value: 'button[aria-controls$="-content-PORTRAIT_3_4"]' }
            },
            countVideo: {
                '1': { type: 'text', value: ['1x'] },
                '2': { type: 'text', value: ['x2', '2x'] },
                '3': { type: 'text', value: ['x3', '3x'] },
                '4': { type: 'text', value: ['x4', '4x'] }
            },
            countImage: {
                '1': { type: 'text', value: ['1x'] },
                '2': { type: 'text', value: ['x2', '2x'] },
                '3': { type: 'text', value: ['x3', '3x'] },
                '4': { type: 'text', value: ['x4', '4x'] }
            },
            durationVideo: {
                '4s': { type: 'selector', value: 'button.flow_tab_slider_trigger:has-text("4s"), button.flow_tab_slider_trigger[aria-controls$="-content-4"], button[id$="-trigger-4"]' },
                '6s': { type: 'selector', value: 'button.flow_tab_slider_trigger:has-text("6s"), button.flow_tab_slider_trigger[aria-controls$="-content-6"], button[id$="-trigger-6"]' },
                '8s': { type: 'selector', value: 'button.flow_tab_slider_trigger:has-text("8s"), button.flow_tab_slider_trigger[aria-controls$="-content-8"], button[id$="-trigger-8"]' }
            },
            model: {
                trigger_video: { type: 'custom', value: 'model_dropdown' },
                trigger_image: { type: 'custom', value: 'model_dropdown' },
                'Veo 3.1 - Lite [Lower Priority]': { type: 'selector', value: '[role="menuitemradio"]:has-text("Veo 3.1 - Lite"), [role="menuitem"]:has-text("Veo 3.1 - Lite"), [role="option"]:has-text("Veo 3.1 - Lite")' },
                'Veo 3.1 - Fast': { type: 'selector', value: '[role="menuitemradio"]:has-text("Veo 3.1 - Fast"), [role="menuitem"]:has-text("Veo 3.1 - Fast"), [role="option"]:has-text("Veo 3.1 - Fast")' },
                'Veo 3.1 - Quality': { type: 'selector', value: '[role="menuitemradio"]:has-text("Veo 3.1 - Quality"), [role="menuitem"]:has-text("Veo 3.1 - Quality"), [role="option"]:has-text("Veo 3.1 - Quality")' },
                'Nano Banana Pro': { type: 'selector', value: '[role="menuitemradio"]:has-text("Nano Banana Pro"), [role="menuitem"]:has-text("Nano Banana Pro"), [role="option"]:has-text("Nano Banana Pro")' },
                'nano banana 2': { type: 'selector', value: '[role="menuitemradio"]:has-text("nano banana 2"), [role="menuitem"]:has-text("nano banana 2"), [role="option"]:has-text("nano banana 2")' },
                'Imagen 4 Ultra': { type: 'selector', value: '[role="menuitemradio"]:text-is("Imagen 4 Ultra"), [role="menuitem"]:text-is("Imagen 4 Ultra"), [role="option"]:text-is("Imagen 4 Ultra")' },
                'Imagen 4': { type: 'selector', value: '[role="menuitemradio"]:text-is("Imagen 4"), [role="menuitem"]:text-is("Imagen 4"), [role="option"]:text-is("Imagen 4")' },
                'Imagen 3': { type: 'selector', value: '[role="menuitemradio"]:text-is("Imagen 3"), [role="menuitem"]:text-is("Imagen 3"), [role="option"]:text-is("Imagen 3")' }
            }
        };

        // Click helper — locator.click() qua CloakBrowser humanize pipeline, chính xác + né bot
        const menuClickOpts = { humanConfig: { idle_between_actions: false } };
        const clickDynamicNode = async (map, key) => {
            if (!key || !map) return false;
            const c = map[key];
            if (!c) {
                this.log(`[STEP 6] ⚠ No coords entry for key "${key}"`);
                return false;
            }
            try {
                if (c.type === 'selector') {
                    let loc = page.locator(c.value);
                    if (c.filterText) {
                        loc = loc.filter({ hasText: c.filterText });
                    }
                    loc = loc.last();
                    if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await loc.click(menuClickOpts);
                        await this.sleep(200 + Math.random() * 100);
                        return true;
                    }
                } else if (c.type === 'text') {
                    for (const text of c.value) {
                        const loc = page.locator(`button, [role="button"], [role="tab"], [role="menuitem"], [role="menuitemradio"], [role="option"], li, span`).filter({ hasText: text }).last();
                        if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                            await loc.click(menuClickOpts);
                            await this.sleep(200 + Math.random() * 100);
                            return true;
                        }
                    }
                } else if (c.type === 'custom' && c.value === 'pill_button') {
                    const result = await page.evaluate(() => {
                        const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
                        const keywords = ['video', 'nano', 'imagen', 'veo', '1x', '2x', '3x', '4x', 'settings', 'cài đặt'];
                        const debug = { total: btns.length, candidates: [] };

                        for (let i = btns.length - 1; i >= 0; i--) {
                            const btn = btns[i];
                            const text = (btn.textContent || '').trim().toLowerCase();
                            const r = btn.getBoundingClientRect();
                            const info = { text: text.substring(0, 60), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
                            debug.candidates.push(info);
                            if (r.width > 0 && r.height > 0 && keywords.some(kw => text.includes(kw))) {
                                return { coords: { x: r.x + r.width / 2, y: r.y + r.height / 2 }, debug, strategy: 'keyword' };
                            }
                        }

                        for (let i = btns.length - 1; i >= 0; i--) {
                            const btn = btns[i];
                            const icons = btn.querySelectorAll('i, .google-symbols, [class*="google-symbols"]');
                            for (const icon of icons) {
                                const iconText = (icon.textContent || '').trim().toLowerCase();
                                if (iconText === 'settings_2' || iconText === 'settings' || iconText === 'tune') {
                                    const r = btn.getBoundingClientRect();
                                    if (r.width > 0 && r.height > 0) {
                                        return { coords: { x: r.x + r.width / 2, y: r.y + r.height / 2 }, debug, strategy: 'icon' };
                                    }
                                }
                            }
                        }

                        return { coords: null, debug, strategy: 'none' };
                    }).catch(e => ({ coords: null, debug: { error: e.message }, strategy: 'error' }));

                    if (result && result.debug) {
                        if (result.strategy === 'error') {
                            this.log(`[STEP 6] pill_button scan ERROR: ${result.debug.error}`);
                        } else {
                            this.log(`[STEP 6] pill_button scan: ${result.debug.total} buttons found, strategy=${result.strategy}, candidates=${JSON.stringify(result.debug.candidates || [])}`);
                        }
                    }

                    if (result && result.coords) {
                        await this.humanClick(page, result.coords.x, result.coords.y);
                        await this.sleep(200 + Math.random() * 100);
                        return true;
                    }
                } else if (c.type === 'custom' && c.value === 'model_dropdown') {
                    const loc = page.locator('button[aria-haspopup="menu"]')
                        .filter({ has: page.locator('i:has-text("arrow_drop_down")') })
                        .last();
                    if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await loc.click(menuClickOpts);
                        await this.sleep(200 + Math.random() * 100);
                        return true;
                    }
                }
            } catch (e) {
                this.log(`[STEP 6] ⚠ Click error for [${key}]: ${e.message}`);
            }
            this.log(`[STEP 6] ⚠ Element not found for [${key}]`);
            return false;
        };

        const clickCoord = async (map, key) => {
            const ok = await clickDynamicNode(map, key);
            await this.sleep(200 + Math.random() * 200);
            return ok;
        };

        // --- Verify helper: check if a clicked tab has data-state="active" or aria-selected="true" ---
        const verifyActive = async (selector, label) => {
            const loc = page.locator(selector).last();
            try {
                const state = await loc.getAttribute('data-state', { timeout: 1500 }).catch(() => null);
                const ariaSelected = await loc.getAttribute('aria-selected', { timeout: 500 }).catch(() => null);
                const isActive = state === 'active' || ariaSelected === 'true';
                if (!isActive) {
                    this.log(`[STEP 6] ⚠ VERIFY: "${label}" not active (data-state="${state}", aria-selected="${ariaSelected}")`);
                }
                return isActive;
            } catch (e) {
                return false;
            }
        };

        // --- Click with verify + retry (max 2 retries) ---
        const clickWithVerify = async (map, key, verifySelector, label) => {
            for (let attempt = 0; attempt <= 2; attempt++) {
                const clicked = await clickDynamicNode(map, key);
                if (!clicked) return false;
                await this.sleep(150 + Math.random() * 100);
                if (!verifySelector || await verifyActive(verifySelector, label)) return true;
                if (attempt < 2) this.log(`[STEP 6] Retry ${attempt + 1}/2 for "${label}"...`);
            }
            this.log(`[STEP 6] ⚠ VERIFY_FAILED: "${label}" after 3 attempts`);
            return false;
        };

        const mustClickWithVerify = async (map, key, verifySelector, label) => {
            const ok = await clickWithVerify(map, key, verifySelector, label);
            if (!ok) throw new Error(`CLICK_VERIFY_FAILED: ${label}`);
            return true;
        };

        // --- 6.0: Open settings popup (with retry for slow-loading toolbar) ---
        this.log('[STEP 6.0] Opening settings popup (trigger_create_menu)...');
        let opened = false;
        for (let attempt = 0; attempt < 5; attempt++) {
            opened = await clickDynamicNode(coords.modes, 'trigger_create_menu');
            if (opened) break;
            if (attempt < 4) {
                this.log(`[STEP 6.0] Toolbar not ready (attempt ${attempt + 1}/5). Waiting 2s for React to render...`);
                await this.sleep(2000 + Math.random() * 500);
            }
        }
        if (!opened) {
            throw new Error('CLICK_VERIFY_FAILED: trigger_create_menu not found');
        }
        await this.sleep(200 + Math.random() * 150);

        // --- 6.1: Switch Video/Image mode ---
        const TYPE_VIDEO = job.TYPE_VIDEO || (isVideoJob ? 'T2V' : 'IMG');
        this.log(`[STEP 6.1] Selecting mode: ${TYPE_VIDEO}...`);
        const modeSelector = coords.modes[TYPE_VIDEO]?.value;
        try {
            await mustClickWithVerify(coords.modes, TYPE_VIDEO, modeSelector, `mode:${TYPE_VIDEO}`);
        } catch(e) {
            this.log(`[STEP 6.1] Mode tab not found, assuming new unified UI (skipping tab click)...`);
        }
        await this.sleep(150 + Math.random() * 150);

        // Sub-mode for I2V/IN2V
        if (TYPE_VIDEO === 'IN2V' || TYPE_VIDEO === 'I2V') {
            this.log(`[STEP 6.1b] Switching to sub-tab for ${TYPE_VIDEO}...`);
            const subSelector = coords.subModes[TYPE_VIDEO]?.value;
            try {
                await mustClickWithVerify(coords.subModes, TYPE_VIDEO, subSelector, `subMode:${TYPE_VIDEO}`);
            } catch(e) {
                this.log(`[STEP 6.1b] Sub-tab not found, assuming new unified UI...`);
            }
            await this.sleep(150 + Math.random() * 150);
        }

        // --- 6.2: Set aspect ratio ---
        if (isVideoJob) {
            let ratioKey = targetRatio;
            if (ratioKey === '16:9') ratioKey = 'Ngang';
            if (ratioKey === '9:16') ratioKey = 'Dọc';
            this.log(`[STEP 6.2] Setting video ratio: ${ratioKey}...`);
            const ratioSelector = coords.ratioVideo[ratioKey]?.value;
            await mustClickWithVerify(coords.ratioVideo, ratioKey, ratioSelector, `ratio:${ratioKey}`);
        } else {
            this.log(`[STEP 6.2] Setting image ratio: ${targetRatio}...`);
            const ratioSelector = coords.ratioImage[targetRatio]?.value;
            await mustClickWithVerify(coords.ratioImage, targetRatio, ratioSelector, `ratio:${targetRatio}`);
        }

        // --- 6.3: Set generation count ---
        this.log(`[STEP 6.3] Setting count: ${targetCount}...`);
        try {
            const countLoc = page
                .locator('button.flow_tab_slider_trigger, button[role="tab"], button[aria-controls*="content"]')
                .filter({ hasText: new RegExp('^x?' + targetCount + 'x?$|^' + targetCount + '$', 'i') })
                .last();
            await countLoc.click({ humanConfig: { idle_between_actions: false } });
            await this.sleep(200 + Math.random() * 100);
        } catch (e) {
            this.log(`[STEP 6.3] ⚠️ Failed to click count ${targetCount}: ${e.message}`);
        }

        // --- 6.4: Set duration (video only) ---
        if (isVideoJob) {
            // job.DURATION comes from API as integer (4/6/8), convert to '4s'/'6s'/'8s'
            let duration = jobConfig.videoDuration || '8s';
            if (job.DURATION) {
                const durNum = parseInt(job.DURATION, 10);
                if (durNum === 4 || durNum === 6 || durNum === 8) {
                    duration = `${durNum}s`;
                }
            }
            this.log(`[STEP 6.4] Setting duration: ${duration}...`);
            const durOk = await clickCoord(coords.durationVideo, duration);
            if (!durOk) throw new Error(`CLICK_VERIFY_FAILED: duration:${duration}`);
        }

        // --- 6.5: Model selection with verify ---
        this.log(`[STEP 6.5] Setting model: "${targetModelName}"...`);
        const triggerKey = isVideoJob ? 'trigger_video' : 'trigger_image';
        await this.clickModelDropdownWithVerify(page, clickCoord, coords, triggerKey, targetModelName);

        // --- 6.6: Close settings popup ---
        this.log('[STEP 6.6] Closing settings popup...');
        await page.keyboard.press('Escape');
        await this.sleep(150 + Math.random() * 150);

        this._lastAppliedSettings = {
            model: targetModelName,
            ratio: targetRatio,
            count: targetCount,
            type: job.TYPE_VIDEO
        };
        this.log('[STEP 6] ✓ Menu setup complete.');
    }

    /**
     * STEP 7: Upload Reference Images
     * IMG mode: upload reference images (deduplicated) via established uploadImages flow
     * I2V mode: upload start/end frames via uploadI2VFrames
     */
    async uploadReferenceImages(page, job) {
        const accountId = this.accountData.id || this.id;
        const lockKey = `${accountId}:reference-upload`;

        this.log(`[Worker] 🤖 STEP 7/9: Upload Reference Images 🤖 - Chờ khóa upload safeUploadMode cho account: ${lockKey}...`);
        this.isUploadingReference = true;
        const releaseLock = await acquireUploadLock(lockKey);
        try {
            this.log(`[Worker] Khóa upload rộng đã được thiết lập cho account: ${accountId}. Bắt đầu thực thi upload...`);
            if (job.TYPE_VIDEO === 'IMG' || job.TYPE_VIDEO === 'IN2V') {
                // Collect ALL image paths from job data (IMAGE_PATH, IMAGE_PATH_2..IMAGE_PATH_10)
                // then DEDUPLICATE by resolved absolute path to avoid uploading the same file multiple times
                const rawPaths = [
                    job.IMAGE_PATH, job.IMAGE_PATH_2, job.IMAGE_PATH_3, job.IMAGE_PATH_4, job.IMAGE_PATH_5,
                    job.IMAGE_PATH_6, job.IMAGE_PATH_7, job.IMAGE_PATH_8, job.IMAGE_PATH_9, job.IMAGE_PATH_10
                ].filter(p => p && typeof p === 'string' && p.trim() !== '');

                // Resolve to absolute + normalize slashes, then dedupe
                const seen = new Set();
                const allPaths = [];
                for (const p of rawPaths) {
                    const resolved = path.resolve(p.trim()).toLowerCase();
                    if (!seen.has(resolved)) {
                        seen.add(resolved);
                        allPaths.push(p.trim());
                    }
                }
                this.log(`[STEP 7] Paths: ${rawPaths.length} raw -> ${allPaths.length} unique after resolve/dedupe.`);

                // Bắt buộc phải có reference images cho ảnh phân cảnh (khung hình đầu tiên)
                if (job.TYPE_VIDEO === 'IMG' && job.FRAME_TYPE === 'first_frame' && allPaths.length === 0) {
                    throw new Error('STORYBOARD_IMAGE_REF_REQUIRED: Khung hình đầu phân cảnh bắt buộc phải có ảnh tham chiếu.');
                }

                if (allPaths.length > 0) {
                    this.log(`[STEP 7] Found ${allPaths.length} unique reference image(s).`);
                    await this.uploadImages(page, allPaths);
                } else {
                    this.log('[STEP 7] No reference images for IMG mode.');
                }
            } else if (job.TYPE_VIDEO === 'I2V') {
                this.log('[STEP 7] Uploading I2V frames...');
                this._currentJob = job; // Lưu job reference cho recovery trong uploadI2VFrames
                await this.uploadI2VFrames(page, job.IMAGE_PATH);
            } else {
                this.log('[STEP 7] No upload needed for this job type.');
            }
        } finally {
            this.isUploadingReference = false;
            releaseLock();
            this.log(`[Worker] Đã giải phóng khóa upload safeUploadMode cho account: ${accountId}.`);
        }
    }

    /**
     * STEP 8: Paste Prompt & Submit
     * Editor is Slate.js: div[data-slate-editor="true"][role="textbox"] (NOT a textarea)
     * Placeholder: "Bạn muốn tạo gì?"
     */
    async pastePromptAndSubmit(page, job) {
        this.log('[Worker] [step8_started] 🤖 STEP 8/9: Paste Prompt & Submit 🤖');
        const cleanPrompt = String(job.PROMPT || '').normalize('NFC');

        // Check if gallery dialog is still open (uncompleted upload indicator)
        const isGalleryOpen = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"], div[class*="dialog"], div[class*="modal"]');
            return !!dialog && dialog.offsetParent !== null;
        }).catch(() => false);

        if (isGalleryOpen) {
            let canCleanupAndProceed = false;
            if (job.TYPE_VIDEO === 'I2V' && job.IMAGE_PATH && typeof job.IMAGE_PATH === 'string' && job.IMAGE_PATH.trim() !== '') {
                const slotOk = await this.verifyI2VStartSlotHasImage(page);
                if (slotOk) {
                    this.log('[STEP 8] I2V slot already has image. Gallery dialog is open but we can safe-dismiss it via Escape.');
                    canCleanupAndProceed = true;
                }
            }

            if (canCleanupAndProceed) {
                this.log('[STEP 8] Gallery dialog still open but I2V slot is valid. Pressing Escape to dismiss...');
                await page.keyboard.press('Escape');
                await this.sleep(1000);
            } else {
                this.log('[STEP 8] 🛑 LỖI NGHIÊM TRỌNG: Hộp thoại Gallery vẫn hiển thị lơ lửng (chưa hoàn tất upload). Chặn dán prompt.');
                throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Hộp thoại Gallery vẫn mở khi bắt đầu Step 8');
            }
        }

        // Dismiss any lingering popup (gallery dialog from STEP 7 can stay open and block editor)
        this.log('[STEP 8] Dismissing any open popups...');
        const closed = await page.evaluate(() => {
            let count = 0;
            const overlays = document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], div[class*="overlay"], div[class*="backdrop"]');
            for (const el of overlays) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    count++;
                }
            }
            return count;
        }).catch(() => 0);

        if (closed > 0) {
            this.log(`[STEP 8] Detected ${closed} open popups/overlays. Pressing Escape to dismiss...`);
            await page.keyboard.press('Escape');
            await this.sleep(300 + Math.random() * 200); // Give time for backdrop fade-out transition
        } else {
            await page.keyboard.press('Escape');
            await this.sleep(300 + Math.random() * 200);
        }

        // --- Verify reference images attachment cards count ---
        let expectedCount = 0;
        if (job.TYPE_VIDEO === 'IMG' || job.TYPE_VIDEO === 'IN2V') {
            const rawPaths = [
                job.IMAGE_PATH, job.IMAGE_PATH_2, job.IMAGE_PATH_3, job.IMAGE_PATH_4, job.IMAGE_PATH_5,
                job.IMAGE_PATH_6, job.IMAGE_PATH_7, job.IMAGE_PATH_8, job.IMAGE_PATH_9, job.IMAGE_PATH_10
            ].filter(p => p && typeof p === 'string' && p.trim() !== '');

            const seen = new Set();
            for (const p of rawPaths) {
                const resolved = path.resolve(p.trim()).toLowerCase();
                if (!seen.has(resolved)) {
                    seen.add(resolved);
                    expectedCount++;
                }
            }
        } else if (job.TYPE_VIDEO === 'I2V') {
            if (job.IMAGE_PATH && typeof job.IMAGE_PATH === 'string' && job.IMAGE_PATH.trim() !== '') {
                const slotOk = await this.verifyI2VStartSlotHasImage(page);
                this.log(`[STEP 8] I2V slot verification: ${slotOk ? 'OK' : 'FAILED'}`);
                if (!slotOk) {
                    throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: I2V Start slot missing image before prompt submit');
                }
            }
        }

        if (expectedCount > 0) {
            const actualCount = await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('button[data-card-open][data-state]')).filter(card => {
                    const img = card.querySelector('img[src*="media.getMediaUrlRedirect"]');
                    if (!img) return false;
                    const hasCancelIcon = Array.from(card.querySelectorAll('i, span, div, button')).some(el => {
                        const txt = (el.textContent || el.innerText || '').trim().toLowerCase();
                        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                        const cls = (el.className || '').toLowerCase();
                        return txt === 'cancel' || txt === 'close' || txt === 'delete' || txt === 'remove' ||
                            aria.includes('cancel') || aria.includes('close') || aria.includes('delete') || aria.includes('remove') ||
                            cls.includes('cancel') || cls.includes('close') || cls.includes('delete') || cls.includes('remove');
                    });
                    return hasCancelIcon;
                });
                return cards.length;
            }).catch(() => 0);

            this.log(`[STEP 8] Verification check: expectedCount=${expectedCount}, actualCount=${actualCount}`);
            if (actualCount < expectedCount) {
                this.log(`[STEP 8] 🛑 LỖI NGHIÊM TRỌNG: Thiếu attachment cards thật! Chỉ nhận diện được ${actualCount}/${expectedCount} cards. Chặn dán prompt.`);
                throw new Error(`IMAGE_UPLOAD_VERIFY_FAILED: Thiếu attachment cards thật (${actualCount}/${expectedCount})`);
            }
        }

        // Slate.js editor — contenteditable div, NOT textarea
        const editorSelector = 'div[data-slate-editor="true"][role="textbox"]';

        await page.waitForSelector(editorSelector, { state: 'visible', timeout: 10000 });

        // Click Slate editor with failover to force click
        this.log('[STEP 8] Clicking Slate editor...');
        try {
            await page.click(editorSelector, { timeout: 3000, humanConfig: { idle_between_actions: false } });
        } catch (clickErr) {
            this.log(`[STEP 8] Regular click failed (${clickErr.message}). Retrying with force=true...`);
            await page.click(editorSelector, { force: true, humanConfig: { idle_between_actions: false } });
        }
        await this.sleep(200 + Math.random() * 200);

        // --- Robust Prompt Entry ---
        this.log(`[STEP 8] Entering prompt (${cleanPrompt.length} chars)...`);
        let entrySuccess = false;

        try {
            // Focus the Slate editor
            await page.focus(editorSelector);
            await this.sleep(100 + Math.random() * 100);

            // Select all and clear any leftover text
            await page.keyboard.press('Control+a');
            await page.keyboard.press('Backspace');
            await this.sleep(100 + Math.random() * 100);

            // Insert prompt text directly via keyboard.insertText (fast & highly reliable)
            await page.keyboard.insertText(cleanPrompt);
            await this.sleep(300 + Math.random() * 200);

            // Verify if Slate.js editor actually populated the text (properly ignoring placeholder)
            const hasText = await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                if (!el) return false;

                // If a placeholder element is still visible, the editor is empty!
                const placeholder = el.querySelector('[data-slate-placeholder="true"]');
                if (placeholder && placeholder.offsetParent !== null) {
                    return false;
                }

                // Clean the text: remove zero-width spaces (\uFEFF) and trim
                const text = el.textContent.replace(/\uFEFF/g, '').trim();
                return text.length > 0;
            }, editorSelector);

            if (hasText) {
                entrySuccess = true;
                this.log('[STEP 8] ✓ Prompt entered and verified successfully.');
            } else {
                this.log('[STEP 8] ⚠️ insertText verification failed. Trying fallback keyboard.type...');
            }
        } catch (err) {
            this.log(`[STEP 8] ⚠️ Prompt entry attempt failed: ${err.message}`);
        }

        // Fallback: If insertText failed or didn't populate the DOM, try native fast typing
        if (!entrySuccess) {
            try {
                await page.focus(editorSelector);
                await page.keyboard.type(cleanPrompt, { delay: 0 }); // 0ms delay for maximum speed
                this.log('[STEP 8] ✓ Prompt entered via fast typing fallback.');
            } catch (fallbackErr) {
                this.log(`[STEP 8] ❌ Prompt entry fallback failed: ${fallbackErr.message}`);
                // Last resort: try force fill
                await page.fill(editorSelector, cleanPrompt).catch(() => { });
            }
        }
        await this.sleep(400 + Math.random() * 300);

        // Brief review pause
        this.log('[STEP 8] Reviewing prompt...');
        await this.sleep(500 + Math.random() * 700);

        // Submit by clicking the submit button (arrow icon → next to editor)
        // Enter key does NOT submit in Slate.js - it only creates a newline
        this.log('[STEP 8] Clicking submit button...');
        const submitClicked = await page.evaluate(() => {
            // Find the submit button: typically a button with send/arrow_forward/arrow_upward icon
            // or the button right after the editor with type="submit" or aria-label containing "send"/"gửi"
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
                if (btn.offsetParent === null) continue;
                const text = (btn.innerText || '').trim().toLowerCase();
                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                const icons = Array.from(btn.querySelectorAll('i.google-symbols, i[class*="google-symbols"]'));
                const iconText = icons.map(i => i.textContent.trim()).join(' ');

                // Match send/submit icons
                if (iconText.includes('send') || iconText.includes('arrow_forward') ||
                    iconText.includes('arrow_upward') || iconText.includes('arrow_right_alt')) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true, method: 'icon:' + iconText };
                    }
                }
                if (ariaLabel.includes('send') || ariaLabel.includes('gửi') || ariaLabel.includes('submit')) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true, method: 'aria:' + ariaLabel };
                    }
                }
            }
            // Fallback: find a circular/small button near the editor (bottom-right area)
            const editor = document.querySelector('div[data-slate-editor="true"]');
            if (editor) {
                const editorRect = editor.getBoundingClientRect();
                for (const btn of buttons) {
                    if (btn.offsetParent === null) continue;
                    const r = btn.getBoundingClientRect();
                    // Button should be near the editor (same row, to the right)
                    if (r.y >= editorRect.y - 50 && r.y <= editorRect.bottom + 50 && r.x > editorRect.right - 100) {
                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true, method: 'position-near-editor' };
                    }
                }
            }
            return { found: false };
        });

        // --- Snapshot existing tiles BEFORE submit ---
        this._existingTileIds = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('[data-tile-id]'))
                .map(el => el.getAttribute('data-tile-id'));
        });
        this.log(`[STEP 8] Snapshot taken: ${this._existingTileIds.length} existing tiles.`);

        if (submitClicked.found) {
            this.log(`[STEP 8] [prompt_submitted] Submit button found (${submitClicked.method}). Clicking at x:${submitClicked.x}, y:${submitClicked.y}...`);
            await this.humanClick(page, submitClicked.x, submitClicked.y);
        } else {
            // Last resort fallback: try Enter anyway
            this.log('[STEP 8] [prompt_submitted] ⚠️ Submit button not found. Trying Enter as fallback...');
            await page.keyboard.press('Enter');
        }
        await this.sleep(800 + Math.random() * 700);
        this.log('[STEP 8] [prompt_submitted] Prompt đã được gửi thành công, bắt đầu chờ render.');
    }

    async waitAndDownload(page, job, outputDir) {
        this.log('[Worker] 🤖 STEP 9/9: Wait & Download 🤖');

        let jobSuccess = false;
        let downloadedFile = null;
        let hasError = false;
        let currentErrorReason = '';
        let maxWaitSeconds = job.TYPE_VIDEO === 'IMG' ? 70 : 90;
        let targetMediaCoords = null;
        let targetMediaVideoSrc = "";

        // --- 9a: Submit confirmation (15s) ---
        this.log('[STEP 9a] Waiting for submit confirmation (Toast/%)...');
        let submitConfirmed = false;
        for (let check = 0; check < 10; check++) {
            try {
                submitConfirmed = await page.evaluate(() => {
                    const isVisible = (el) => el.offsetParent !== null;
                    const alerts = Array.from(document.querySelectorAll('[role="alert"], [class*="snackbar"], snack-bar, .msg, .toast'));
                    for (let a of alerts) {
                        if (!isVisible(a)) continue;
                        const t = (a.innerText || '').toLowerCase();
                        if (t.includes('đang tạo') || t.includes('creating') || t.includes('queued') || t.includes('working')) return true;
                    }
                    const texts = Array.from(document.querySelectorAll('span, div, p'));
                    return texts.some(el => {
                        if (!isVisible(el)) return false;
                        const r = el.getBoundingClientRect();
                        if (r.y > window.innerHeight - 250) return false; // Skip editor area (upload %)
                        const t = el.textContent.trim();
                        if (t.includes('Đang tạo') || t.includes('Generating')) return true;
                        return t.endsWith('%') && t.length > 1 && t.length <= 5 && !isNaN(parseInt(t));
                    });
                });
                if (submitConfirmed) {
                    this.log('[STEP 9a] ✓ Submit confirmed by system.');
                    break;
                }
            } catch (e) {
                this.log('[STEP 9a] DOM temporarily unavailable, retrying...');
            }
            await this.sleep(1500);
        }
        if (!submitConfirmed) {
            this.log('[STEP 9a] ⚠️ No confirmation after 15s. Continuing with risk...');
        }

        // --- 9b: Render progress tracking ---
        this.log('[STEP 9b] Starting render progress tracking...');
        let hasZodOr429Error = false;
        let zodOr429Reason = '';
        const consoleHandler = (msg) => {
            const text = msg.text() || '';
            if (text.includes('ZodError') || text.includes('429')) {
                hasZodOr429Error = true;
                zodOr429Reason = text.includes('ZodError') ? 'ZodError' : '429_Error';
            }
        };
        // Flag 403/429 only from API generation, not from static/analytics/favicon
        const responseHandler = (response) => {
            const status = response.status();
            if (status !== 403 && status !== 429) return;

            const url = response.url() || '';
            const isGenerationAPI = url.includes('aisandbox-pa.googleapis.com') ||
                url.includes('flowMedia:batchGenerate');

            if (status === 429 && isGenerationAPI) {
                hasZodOr429Error = true;
                zodOr429Reason = '429_Error';
            } else if (status === 403 && isGenerationAPI) {
                hasZodOr429Error = true;
                zodOr429Reason = '403_Forbidden';
            }
        };
        page.on('console', consoleHandler);
        page.on('response', responseHandler);

        // downloadPromise will be registered in 9f, just before download click

        this.hasSeenGenerating = false;
        this.scrolledToTopDuringRender = false;
        this._coordsCapturedAt75 = false;
        let completedTileId = null;
        let waitTime = 0;
        const downloadInterval = setInterval(() => {
            waitTime += 5;
            this.log(`[STEP 9b] Progress: waited ${waitTime}s...`);
        }, 5000);


        try {
            await this.sleep(1500 + Math.random() * 1000);

            // Use snapshot taken BEFORE submit in Step 8
            let existingTileIds = this._existingTileIds || [];
            this.log(`[STEP 9b] Using snapshot of ${existingTileIds.length} existing tiles to isolate new job.`);

            for (let i = 0; i < (maxWaitSeconds / 2); i++) {
                if (this.isKilled) break;
                await this.sleep(2000);

                // --- Humanize: Occasional mouse movement while waiting ---
                // Sitting perfectly still for 7 minutes triggers bot detection.
                // 15% chance per 2s tick to casually move the mouse around.
                if (Math.random() < 0.15) {
                    const idleX = 200 + Math.floor(Math.random() * 1500); // stay somewhat central
                    const idleY = 200 + Math.floor(Math.random() * 700);
                    await page.mouse.move(idleX, idleY).catch(() => { });
                }

                // --- Error detection (scoped to new tiles only) ---
                const errorCheck = await page.evaluate((existingIds) => {
                    const isVisible = (el) => el.offsetParent !== null;
                    const allTiles = Array.from(document.querySelectorAll('[data-tile-id]'));
                    const newTiles = allTiles.filter(t => !existingIds.includes(t.getAttribute('data-tile-id')));
                    if (newTiles.length === 0) return { isError: false, reason: 'no_new_tile' };

                    // Quick scan: if ANY tile has %/generating/queue → veto ALL errors
                    for (const tile of newTiles) {
                        const t = (tile.innerText || '').toLowerCase();
                        if (t.match(/\d+%/) || t.includes('đang tạo') || t.includes('generating') ||
                            t.includes('queued') || t.includes('đang chờ') || t.includes('in queue')) {
                            return { isError: false, reason: 'is_generating_veto' };
                        }
                        // Check completed: tile has img/video and NO error text
                        const hasMedia = tile.querySelector('img, video') !== null;
                        const hasError = t.includes('unusual activity') || t.includes('hoạt động bất thường') ||
                            t.includes('cancelled') || t.includes('not charged');
                        if (hasMedia && !hasError) {
                            return { isError: false, reason: 'is_completed_veto' };
                        }
                    }

                    // No generating/completed tile → check NEWEST tile for error
                    const newest = newTiles[0];
                    const text = (newest.innerText || '').toLowerCase();

                    if (text.includes('unusual activity') || text.includes('hoạt động bất thường')) {
                        return { isError: true, reason: 'unusual_activity' };
                    }
                    if (text.includes('was cancelled') || text.includes('cancelled') || text.includes('not charged')) {
                        return { isError: true, reason: 'queue_cancelled' };
                    }
                    if (text === 'queued' || text.includes('in queue') || text.includes('đang chờ')) {
                        return { isError: true, reason: 'is_queued' };
                    }

                    // Page-level alerts
                    const pageAlerts = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"]'));
                    for (const alert of pageAlerts) {
                        if (!isVisible(alert)) continue;
                        const t = (alert.innerText || '').toLowerCase();
                        if (t.includes('unusual activity') || t.includes('hoạt động bất thường')) {
                            return { isError: true, reason: 'unusual_activity' };
                        }
                    }

                    return { isError: false, reason: 'no_error_indicators' };
                }, existingTileIds);

                if (errorCheck.isError) {
                    currentErrorReason = errorCheck.reason;
                    hasError = true;
                } else if (hasZodOr429Error) {
                    currentErrorReason = zodOr429Reason;
                    hasError = true;
                }

                // --- 3-button error card detection (REMOVED) ---
                // This block was globally scanning the DOM, ignoring tile-based isolation, 
                // and causing false positives from previous jobs' error cards.

                // --- unusual_activity retry: submit lại 3 lần trước khi escalate ---
                if (hasError && currentErrorReason === 'unusual_activity') {
                    this._uaSubmitRetryCount = (this._uaSubmitRetryCount || 0) + 1;
                    if (!this._uaMaxRetries) this._uaMaxRetries = 2 + Math.floor(Math.random() * 3); // 2-4 lần

                    if (this._uaSubmitRetryCount <= this._uaMaxRetries) {
                        this.log(`[STEP 9b] ⚠️ Unusual activity detected. Retry submit ${this._uaSubmitRetryCount}/${this._uaMaxRetries} in a moment (prompt & images still intact)...`);
                        hasError = false;
                        currentErrorReason = '';
                        const retryWait = 3000 + Math.floor(Math.random() * 4000); // 3-7s
                        this.log(`[STEP 9b] Waiting ${Math.round(retryWait / 1000)}s before retry...`);
                        await this.sleep(retryWait);

                        // Re-click submit button (reuse submit finder from step 8)
                        const retrySubmit = await page.evaluate(() => {
                            const buttons = Array.from(document.querySelectorAll('button'));
                            for (const btn of buttons) {
                                if (btn.offsetParent === null) continue;
                                const icons = Array.from(btn.querySelectorAll('i.google-symbols, i[class*="google-symbols"]'));
                                const iconText = icons.map(i => i.textContent.trim()).join(' ');
                                if (iconText.includes('send') || iconText.includes('arrow_forward') ||
                                    iconText.includes('arrow_upward') || iconText.includes('arrow_right_alt')) {
                                    const r = btn.getBoundingClientRect();
                                    if (r.width > 0 && r.height > 0) {
                                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true };
                                    }
                                }
                                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                                if (ariaLabel.includes('send') || ariaLabel.includes('gửi') || ariaLabel.includes('submit')) {
                                    const r = btn.getBoundingClientRect();
                                    if (r.width > 0 && r.height > 0) {
                                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true };
                                    }
                                }
                            }
                            return { found: false };
                        }).catch(() => ({ found: false }));

                        if (retrySubmit.found) {
                            this.log(`[STEP 9b] Re-clicking submit at x:${retrySubmit.x}, y:${retrySubmit.y}...`);
                            await this.humanClick(page, retrySubmit.x, retrySubmit.y);
                        } else {
                            this.log('[STEP 9b] ⚠️ Submit button not found for retry. Trying Enter...');
                            await page.keyboard.press('Enter');
                        }

                        // KHÔNG re-snapshot tiles. Giữ nguyên existingTileIds gốc (từ step 8)
                        // để tile unusual_activity vẫn là "new" → khi Google update thành "đang tạo"
                        // thì detection sẽ thấy nó đang generating.

                        await this.sleep(800 + Math.random() * 700);
                        continue; // Quay lại vòng poll
                    }

                    // Tất cả retry đều fail → throw lên orchestrator
                    this.log(`[STEP 9b] ❌ Unusual activity persists after ${this._uaMaxRetries} submit retries. Escalating to Orchestrator Phase 1...`);
                    this._uaSubmitRetryCount = 0;
                    this._uaMaxRetries = 0;
                    break; // Fall through to error handling → throw UNUSUAL_ACTIVITY_BAN
                }

                // --- queue_cancelled recovery ---
                if (hasError && currentErrorReason === 'queue_cancelled') {
                    this.log('[STEP 9b] ⚠️ queue_cancelled detected. Reloading + 10s recovery...');
                    await this.sleep(3000 + Math.random() * 2000);
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    this.settingsApplied = false;
                    this._lastAppliedSettings = null;
                    await this.sleep(1500 + Math.random() * 1000);
                    let queueRecovered = false;
                    for (let r = 0; r < 10; r++) {
                        await this.sleep(1000);
                        const recovered = await page.evaluate(() => {
                            const texts = Array.from(document.querySelectorAll('span, div, p'));
                            return texts.some(el => {
                                if (el.offsetParent === null) return false;
                                const r = el.getBoundingClientRect();
                                if (r.y > window.innerHeight - 250) return false;
                                const t = el.textContent.trim();
                                const tl = t.toLowerCase();
                                if (t.endsWith('%') && t.length > 1 && t.length <= 5 && !isNaN(parseInt(t))) return true;
                                if (tl.includes('đang tạo') || tl.includes('generating')) return true;
                                if (tl === 'queued' || tl.includes('in queue')) return true;
                                return false;
                            });
                        });
                        if (recovered) {
                            this.log('[STEP 9b] ✓ Job recovered after reload.');
                            queueRecovered = true;
                            hasError = false;
                            this.hasSeenGenerating = true;
                            break;
                        }
                    }
                    if (!queueRecovered) {
                        throw new Error('QUEUE_CANCELLED: Job did not recover after reload.');
                    }
                    continue;
                }

                // --- queued → throw immediately ---
                if (hasError && currentErrorReason === 'is_queued') {
                    this.log('[STEP 9b] ❌ Job stuck in queue. Throwing to retry pipeline...');
                    throw new Error('MEDIA_GENERATION_FAILED: Job stuck in queued state.');
                }

                if (hasError) {
                    this.log(`[STEP 9b] Error detected: ${currentErrorReason}`);
                    this.log(`[STEP 9b] Phát hiện lỗi: ${currentErrorReason}`);
                    break;
                }

                // --- Session expiry check ---
                if (await this.checkAndRecoverSession()) {
                    this.log('[STEP 9b] Phiên làm việc bị ngắt giữa chừng. Đang hủy bỏ...');
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    throw new Error('SESSION_DROPPED: Phiên làm việc Google hết hạn giữa chừng.');
                }

                // --- Tile status: check NEWEST tile, veto errors if any tile has %/queue ---
                const tileStatus = await page.evaluate(([existingIds, isVideoJob]) => {
                    const isVisible = (el) => el.offsetParent !== null;
                    const allTiles = Array.from(document.querySelectorAll('[data-tile-id]'));
                    const newTiles = allTiles.filter(t => !existingIds.includes(t.getAttribute('data-tile-id')));
                    if (newTiles.length === 0) return { state: 'waiting', tileCount: 0 };

                    // Quick scan: if ANY tile has %/generating/queue → return that tile's status
                    for (const tile of newTiles) {
                        const tileId = tile.getAttribute('data-tile-id');
                        const tileText = (tile.innerText || '').toLowerCase();
                        const r = tile.getBoundingClientRect();
                        const coords = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };

                        const percentMatch = tileText.match(/(\d+)%/);
                        if (percentMatch) {
                            return { state: 'generating', tileId, coords, percent: parseInt(percentMatch[1]) };
                        }
                        if (tileText.includes('đang tạo') || tileText.includes('generating') ||
                            tileText.includes('queued') || tileText.includes('đang chờ') || tileText.includes('in queue')) {
                            return { state: 'generating', tileId, coords, percent: 0 };
                        }
                    }

                    // No generating tile → check NEWEST tile only
                    const tile = newTiles[0];
                    const tileId = tile.getAttribute('data-tile-id');
                    const tileText = (tile.innerText || '').toLowerCase();
                    const r = tile.getBoundingClientRect();
                    const coords = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };

                    const videoEl = tile.querySelector('video');
                    if (videoEl && isVisible(videoEl)) {
                        const vr = videoEl.getBoundingClientRect();
                        const src = videoEl.getAttribute('src') || (videoEl.querySelector('source') ? videoEl.querySelector('source').getAttribute('src') : '') || '';
                        return { state: 'complete', tileId, coords: { x: Math.round(vr.x + vr.width / 2), y: Math.round(vr.y + vr.height / 2) }, videoSrc: src };
                    }
                    const imgEl = tile.querySelector('img');
                    if (imgEl && isVisible(imgEl) && imgEl.getBoundingClientRect().width > 80) {
                        const ir = imgEl.getBoundingClientRect();
                        return { state: 'complete', tileId, coords: { x: Math.round(ir.x + ir.width / 2), y: Math.round(ir.y + ir.height / 2) } };
                    }

                    // Check error
                    const icons = Array.from(tile.querySelectorAll('i.google-symbols, i[class*="google-symbols"]'));
                    const hasWarning = icons.some(i => i.textContent.trim() === 'warning');
                    const isSlowWarning = tileText.includes('nhiều thời gian hơn dự kiến') || tileText.includes('longer than expected');
                    if (isSlowWarning) {
                        return { state: 'generating', tileId, coords, percent: 99 };
                    }
                    if (hasWarning || tileText.includes('không thành công')) {
                        return { state: 'error', tileId, coords, reason: 'tile_error', text: tileText.substring(0, 100) };
                    }

                    // Unknown → treat as generating
                    return { state: 'generating', tileId, coords, percent: -1 };
                }, [existingTileIds, job.TYPE_VIDEO !== 'IMG']);

                // Log tile status periodically
                if (tileStatus.state !== this._lastTileState) {
                    this.log(`[STEP 9b] Tile status: ${tileStatus.state} ${tileStatus.tileId ? `(${tileStatus.tileId.substring(0, 20)})` : ''} ${tileStatus.percent !== undefined ? tileStatus.percent + '%' : ''}`);
                    this._lastTileState = tileStatus.state;
                }

                if (tileStatus.state === 'complete') {
                    this.log('[STEP 9b] ✓ Render COMPLETE — media element detected on new tile.');
                    targetMediaCoords = tileStatus.coords;
                    completedTileId = tileStatus.tileId;
                    targetMediaVideoSrc = tileStatus.videoSrc || '';
                    this.hasSeenGenerating = true;

                    this.successfulGenerations = (this.successfulGenerations || 0) + 1;
                    if (this.successfulGenerations >= 50) {
                        this.log(`[Worker] 🎉 50 consecutive successful generations! Flagging for proactive reset...`);
                        this.needsProactiveReset = true;
                    }

                    break;
                }

                if (tileStatus.state === 'error') {
                    this.log(`[STEP 9b] ❌ New tile shows error: ${tileStatus.text}`);
                    hasError = true;
                    currentErrorReason = 'tile_generation_error';
                    break;
                }

                if (tileStatus.state === 'generating') {
                    if (!this.hasSeenGenerating) {
                        this.log('[STEP 9b] Render progress detected on new tile. Tracking...');
                        this.hasSeenGenerating = true;
                    }
                    if (tileStatus.coords) {
                        targetMediaCoords = tileStatus.coords;
                    }
                    // Scroll to top for accurate coordinates on first detection
                    if (!this.scrolledToTopDuringRender) {
                        await page.evaluate(() => window.scrollTo(0, 0));
                        this.scrolledToTopDuringRender = true;
                    }
                }
            }

            page.off('console', consoleHandler);
            page.off('response', responseHandler);
            clearInterval(downloadInterval);

            // --- 9c: Error handling ---
            if (hasError) {
                if (currentErrorReason === 'unusual_activity' || currentErrorReason === '403_Forbidden') {
                    this.log(`[STEP 9c] ${currentErrorReason} detected. Throwing to Orchestrator for recovery...`);
                    throw new Error('UNUSUAL_ACTIVITY_BAN: 403_Forbidden or unusual activity detected.');
                }
                this.log(`[STEP 9c] Generation failed: ${currentErrorReason}. Reloading...`);
                await page.reload({ waitUntil: 'domcontentloaded' });
                this.settingsApplied = false;
                this._lastAppliedSettings = null;
                await this.sleep(2000 + Math.random() * 1000);
                throw new Error(`MEDIA_GENERATION_FAILED: ${currentErrorReason}`);
            }

            if (!this.hasSeenGenerating) {
                this.log('[STEP 9c] ⚠️ Timeout: no render indicator ever detected. Reloading...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                this.settingsApplied = false;
                this._lastAppliedSettings = null;
                throw new Error('MEDIA_GENERATION_FAILED: No render progress detected within timeout.');
            }

            // --- 9e: Clear prompt box ---
            this.log('[STEP 9e] Clearing prompt box before download...');
            try {
                const clearCoords = await page.evaluate(() => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    for (const btn of btns) {
                        const text = (btn.innerText || '').trim().toLowerCase();
                        const icon = btn.querySelector('i.google-symbols, i[class*="google-symbols"]');
                        const isClear =
                            text.includes('xoá câu lệnh') ||
                            text.includes('xóa câu lệnh') ||
                            text.includes('clear prompt') ||
                            (icon && icon.textContent.trim() === 'close');
                        if (isClear) {
                            const r = btn.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) {
                                return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                            }
                        }
                    }
                    return null;
                });
                if (clearCoords) {
                    // Button is ~32x32, random ±6px from center stays safely inside (10px margin)
                    const clrX = clearCoords.x + (Math.random() * 12 - 6);
                    const clrY = clearCoords.y + (Math.random() * 12 - 6);
                    await this.humanClick(page, clrX, clrY);
                    this.log('[STEP 9e] ✓ Prompt cleared.');
                }
            } catch (e) {
                this.log('[STEP 9e] Error clearing prompt: ' + e.message);
            }
            await this.sleep(1000);

            this.log('[STEP 9f] Starting download...');
            // Sử dụng humanClick thay vì rawMouse để né bot detection

            const isIMG = job.TYPE_VIDEO === 'IMG';
            const resolution = isIMG
                ? (job.settings?.photoQuality || '1K')
                : (job.settings?.videoQuality || '1080p');

                // Register download event BEFORE interaction
                const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
                downloadPromise.catch(() => { }); // Mute UnhandledPromiseRejection if page closes early

                // Scroll to top for accurate coordinates
                await page.evaluate(() => window.scrollTo(0, 0));
                await this.sleep(500);

                if (completedTileId) {
                    const updatedCoords = await page.evaluate((tileId) => {
                        const tile = document.querySelector(`[data-tile-id="${tileId}"]`);
                        if (!tile) return null;
                        const isVisible = (el) => el.offsetParent !== null;
                        const videoEl = tile.querySelector('video');
                        if (videoEl && isVisible(videoEl)) {
                            const vr = videoEl.getBoundingClientRect();
                            return { x: Math.round(vr.x + vr.width / 2), y: Math.round(vr.y + vr.height / 2) };
                        }
                        const imgEl = tile.querySelector('img');
                        if (imgEl && isVisible(imgEl)) {
                            const ir = imgEl.getBoundingClientRect();
                            return { x: Math.round(ir.x + ir.width / 2), y: Math.round(ir.y + ir.height / 2) };
                        }
                        const tr = tile.getBoundingClientRect();
                        return { x: Math.round(tr.x + tr.width / 2), y: Math.round(tr.y + tr.height / 2) };
                    }, completedTileId).catch(() => null);

                    if (updatedCoords) {
                        this.log(`[STEP 9f] Dynamically updated coordinates for tile ${completedTileId}: x=${updatedCoords.x}, y=${updatedCoords.y}`);
                        targetMediaCoords = updatedCoords;
                    } else {
                        this.log(`[STEP 9f] ⚠️ Failed to query dynamic coordinates for tile ${completedTileId}. Using cached coordinates.`);
                    }
                }

                // --- Find media target (Use tracked coordinates) ---
                this.log('[STEP 9f] Waiting 4 seconds for media UI to settle...');
                await this.sleep(1500 + Math.floor(Math.random() * 1000));

                if (!targetMediaCoords) {
                    this.log('[STEP 9f] Media target not tracked. Using fallback center coordinates...');
                    const vp = page.viewportSize();
                    targetMediaCoords = { x: vp ? Math.round(vp.width / 2) : 600, y: vp ? Math.round(vp.height / 2) : 400 };
                } else {
                    this.log(`[STEP 9f] Using saved tile coordinates: x=${targetMediaCoords.x}, y=${targetMediaCoords.y}`);
                }

                // --- Hover + Right-click ---
                const rcOffsetX = Math.random() * 10 - 5;
                const rcOffsetY = Math.random() * 10 - 5;
                const rcX = targetMediaCoords.x + rcOffsetX;
                const rcY = targetMediaCoords.y + rcOffsetY;
                this.log(`[STEP 9f] Hovering media at x:${Math.round(rcX)}, y:${Math.round(rcY)} (offset ±5px)`);
                const rcSteps = 10 + Math.floor(Math.random() * 8);
                await page.mouse.move(rcX, rcY, { steps: rcSteps });
                await this.sleep(300 + Math.floor(Math.random() * 500));
                this.log('[STEP 9f] Right-clicking media...');
                await page.mouse.down({ button: 'right' });
                await this.sleep(50 + Math.floor(Math.random() * 50));
                await page.mouse.up({ button: 'right' });
                await this.sleep(1000);

                // Verify context menu thực sự mở, nếu không retry right-click (max 2 lần)
                let menuVisible = false;
                for (let retryRC = 0; retryRC < 3; retryRC++) {
                    if (retryRC > 0) {
                        this.log(`[STEP 9f] Context menu not found. Retrying right-click (${retryRC}/2)...`);
                        await page.mouse.move(rcX + (Math.random() * 10 - 5), rcY + (Math.random() * 10 - 5), { steps: 5 });
                        await this.sleep(500);
                        await page.mouse.down({ button: 'right' });
                        await this.sleep(50 + Math.floor(Math.random() * 50));
                        await page.mouse.up({ button: 'right' });
                        await this.sleep(1000);
                    }
                    menuVisible = await page.evaluate(() => {
                        const menu = document.querySelector('[role="menu"]');
                        if (!menu) return false;
                        const r = menu.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    });
                    if (menuVisible) {
                        this.log('[STEP 9f] Context menu visible.');
                        break;
                    }
                }

                if (!menuVisible) {
                    throw new Error('Context menu failed to open after multiple right-clicks.');
                }

                // --- Find "Tải xuống" in context menu ---
                this.log('[STEP 9f] Finding "Tải xuống" in context menu...');
                const downloadCoords = await page.evaluate(() => {
                    const items = Array.from(document.querySelectorAll(
                        '[role="menu"] li, [role="menu"] [role="menuitem"], [role="menu"] button, [role="menu"] div'
                    ));
                    for (const item of items) {
                        const t = (item.innerText || item.textContent || '').trim().toLowerCase();
                        const isDownload =
                            (t.includes('tải xuống') || t.includes('download')) &&
                            !t.includes('tất cả') && !t.includes('all') && !t.includes('zip') &&
                            t.length < 80;
                        if (isDownload) {
                            const r = item.getBoundingClientRect();
                            if (r.width > 30 && r.height > 10) {
                                return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                            }
                        }
                    }
                    return null;
                });

                if (!downloadCoords) {
                    throw new Error('Could not find download menu item.');
                }

                const dlOffsetX = Math.random() * 6 - 3;
                const dlOffsetY = Math.random() * 6 - 3;
                const dlX = downloadCoords.x + dlOffsetX;
                const dlY = downloadCoords.y + dlOffsetY;
                this.log(`[STEP 9f] Hovering "Tải xuống" at x:${Math.round(dlX)}, y:${Math.round(dlY)}...`);
                await this.humanClick(page, dlX, dlY, { humanConfig: { idle_between_actions: false } });
                await this.sleep(600 + Math.floor(Math.random() * 400)); // Wait for quality submenu to appear

                // --- Select quality from submenu (270p / 720p / 1080p / 4K) ---
                const type = job.TYPE_VIDEO;
                this.log(`[STEP 9f] Looking for quality submenu (target: ${isIMG ? '1K' : resolution})...`);

                const qualityCoords = await page.evaluate(({ type, resolution }) => {
                    const allItems = Array.from(document.querySelectorAll(
                        '[role="menu"] li, [role="menu"] [role="menuitem"], [role="menu"] button, [role="menu"] div, [role="listbox"] div, div[class*="menu"] div'
                    ));

                    // Pass 1: Try to find the exact target resolution / quality specified by the user
                    for (const item of allItems) {
                        const t = (item.innerText || item.textContent || '').trim();
                        const firstLine = t.split('\n')[0].trim();
                        let ok = false;
                        if (type === 'IMG') {
                            // Image quality matching (1K / Original / 2K / 4K)
                            ok = firstLine.includes(resolution) ||
                                (resolution === '1K' && firstLine.includes('Original'));
                        } else {
                            // Video quality matching (270p / 720p / 1080p)
                            ok = firstLine.includes(resolution);
                        }

                        if (ok) {
                            const r = item.getBoundingClientRect();
                            if (r.width > 30 && r.height > 10 && r.x > 0 && r.y > 0) {
                                return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 6 - 3) };
                            }
                        }
                    }

                    // Pass 2: Fallback to any of the expected qualities in descending order of preference if target is not found
                    const fallbacks = type === 'IMG'
                        ? ['1K', 'Original', '2K', '4K']
                        : ['1080p', '720p', '270p'];
                    for (const fallback of fallbacks) {
                        for (const item of allItems) {
                            const t = (item.innerText || item.textContent || '').trim();
                            const firstLine = t.split('\n')[0].trim();
                            if (firstLine.includes(fallback)) {
                                const r = item.getBoundingClientRect();
                                if (r.width > 30 && r.height > 10 && r.x > 0 && r.y > 0) {
                                    return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 6 - 3) };
                                }
                            }
                        }
                    }

                    return null;
                }, { type, resolution });

                if (qualityCoords) {
                    const qX = qualityCoords.x + (Math.random() * 6 - 3);
                    const qY = qualityCoords.y + (Math.random() * 4 - 2);
                    this.log(`[STEP 9f] Clicking quality "${resolution}" at x:${Math.round(qX)}, y:${Math.round(qY)}`);
                    await this.humanClick(page, qX, qY, { humanConfig: { idle_between_actions: false } });
                } else {
                    // Fallback: no submenu appeared, click "Tải xuống" directly
                    this.log('[STEP 9f] Quality submenu not found, clicking "Tải xuống" directly.');
                    await this.humanClick(page, dlX, dlY, { humanConfig: { idle_between_actions: false } });
                }
                await this.sleep(600 + Math.floor(Math.random() * 400)); // Cooldown after download click

                // --- Await download event + save file ---
                this.log('[STEP 9f] Waiting for Playwright download event...');
                const download = await downloadPromise;
                const suggestedName = download.suggestedFilename() || '';
                const ext = path.extname(suggestedName) || (isIMG ? '.png' : '.mp4');

                const projectName = job.PROJECT_NAME || job.PROJECT_ID || 'UnknownProject';
                const safeProjectName = String(projectName).replace(/[<>:"/\\|?*]/g, '_');

                // Use the outputDir passed from backend configuration if it's not empty, otherwise default to C:\
                const baseOutputDir = (outputDir && outputDir.trim()) ? outputDir.trim() : 'C:\\';
                const targetDir = path.join(baseOutputDir, safeProjectName);
                if (!fs.existsSync(targetDir)) {
                    fs.mkdirSync(targetDir, { recursive: true });
                }

                const destPath = path.join(targetDir, `video_${job.JOB_ID}${ext}`);
                await download.saveAs(destPath);
                downloadedFile = destPath;
                jobSuccess = true;
                this.unusualActivityStreak = 0; // Reset streak on successful download
                this.lastSuccessfulDownloadAt = Date.now(); // Track for 15-min no-download restart
                this.log(`[STEP 9f] ✓ Download complete: video_${job.JOB_ID}${ext}`);
        } catch (e) {
            this.log(`[STEP 9] Render/Download failed: ${e.message}`);
            page.off('console', consoleHandler);
            page.off('response', responseHandler);
            clearInterval(downloadInterval);
            jobSuccess = false;
            throw e; // Download now handled inline in waitAndDownload() step 9f using page.waitForEvent('download') + download.saveAs() pattern.
        }

        return { success: jobSuccess, file: downloadedFile };
    }

    async _internalProcessJob(job, outputDir) {
        this.log(`[Orchestrator] Starting 9-Step Pipeline for Job ${job.JOB_ID}`);
        // Reset unusual activity submit retry counter for new job
        this._uaSubmitRetryCount = 0;

        // Clear session-level upload cache only if we are not reusing project
        const currentUrl = this.page ? this.page.url() : '';
        const inActiveProject = currentUrl.match(/\/flow\/project\/[^\/]+/);
        if (!inActiveProject) {
            this._uploadedImages.clear();
        }
        try {
            await this.ensureBrowserReady();

            // Natural resting delay between jobs
            if (this.page.url().includes('labs.google/fx/vi/tools/flow')) {
                const restDelay = 1000 + Math.floor(Math.random() * 2000);
                this.log(`[ANTI-BOT] Nghỉ ngơi ${Math.round(restDelay / 1000)}s trước khi làm job tiếp theo...`);
                await this.sleep(restDelay);
            }

            await this.clickCreateWithFlow(this.page);
            await this.clickNewProject(this.page);
            await this.verifyProjectPage(this.page);
            await this.checkAndToggleAgentButton(this.page);
            await this.setupViewMode(this.page);
            await this.setupCreateMenu(this.page, job);
            await this.uploadReferenceImages(this.page, job);
            await this.pastePromptAndSubmit(this.page, job);
            return await this.waitAndDownload(this.page, job, outputDir);
        } catch (err) {
            this.log(`[Orchestrator] Pipeline failed at some step: ${err.message}`);
            this._lastAppliedSettings = null;
            this.viewModeApplied = false;
            throw err; // Re-throw for orchestrator retry logic
        }
    }

    /**
     * Deep-clean profile directory: purge all transient data (cache, storage, cookies)
     * Keeps: Preferences (re-injected by launch), Extensions
     * Called before every browser launch and during cookie-reset recovery.
     * Synchronous — browser MUST be closed before calling.
     */
    deepCleanProfile(keepSession = false) {
        const profileSubDir = this.chromeProfileName || 'Default';
        const defaultDir = path.join(this.profilePath, profileSubDir);
        if (!fs.existsSync(defaultDir)) {
            this.log(`[DeepClean] No ${profileSubDir}/ directory yet — skipping.`);
            return;
        }

        // Files to delete — ONLY transient/tracking data
        // KEEP: History, Web Data, Favicons, Visited Links, shared_proto_db
        // (these make the profile look like a real returning user to Google)
        let filesToDelete = [
            path.join('Network', 'TrustTokens'),
            'Network Action Predictor',
            'QuotaManager', 'QuotaManager-journal',
            'TransportSecurity',
            'Shortcuts', 'Shortcuts-journal',
            'Affiliation Database', 'Affiliation Database-journal',
        ];
        if (!keepSession) {
            filesToDelete.push(
                // Modern Chromium moved Cookies to Network/
                path.join('Network', 'Cookies'),
                path.join('Network', 'Cookies-journal'),
                'Cookies', 'Cookies-journal',
                // Only delete login/history data on full reset
                'Login Data', 'Login Data-journal',
                'History', 'History-journal',
                'Web Data', 'Web Data-journal',
                'Favicons', 'Favicons-journal',
                'Top Sites', 'Top Sites-journal',
                'Visited Links',
            );
        }
        let deletedFiles = 0;
        for (const file of filesToDelete) {
            const filePath = path.join(defaultDir, file);
            try {
                if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); deletedFiles++; }
            } catch (e) { /* locked or missing — non-fatal */ }
        }

        // Directories to nuke — ONLY heavy caches that waste disk
        // KEEP: shared_proto_db, databases, blob_storage (profile reputation data)
        let dirsToDelete = [
            path.join(defaultDir, 'Cache'),
            path.join(defaultDir, 'Code Cache'),
            path.join(defaultDir, 'GPUCache'),
            path.join(defaultDir, 'DawnCache'),
            path.join(defaultDir, 'optimization_guide_hint_cache'),
            // Top-level caches (outside Default/)
            path.join(this.profilePath, 'GrShaderCache'),
            path.join(this.profilePath, 'ShaderCache'),
            path.join(this.profilePath, 'GraphiteDawnCache'),
        ];
        if (!keepSession) {
            dirsToDelete.push(
                path.join(defaultDir, 'Local Storage'),
                path.join(defaultDir, 'Session Storage'),
                path.join(defaultDir, 'IndexedDB'),
                path.join(defaultDir, 'Service Worker'),
                path.join(defaultDir, 'File System'),
                path.join(defaultDir, 'Sessions'),
                path.join(defaultDir, 'shared_proto_db'),
                path.join(defaultDir, 'databases'),
                path.join(defaultDir, 'blob_storage'),
            );
        }
        let deletedDirs = 0;
        for (const dir of dirsToDelete) {
            try {
                if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); deletedDirs++; }
            } catch (e) { /* locked — non-fatal */ }
        }

        this.log(`[DeepClean] Profile cleaned (keepSession=${keepSession}): ${deletedFiles} files + ${deletedDirs} directories purged.`);
    }

    async quietRestForReputation() {
        const durationMs = 60000 + Math.floor(Math.random() * 60000); // 1–2 phút
        this.log(`[Recovery Rest] Nghỉ im ${Math.round(durationMs / 1000)}s, di chuyển chuột ngẫu nhiên trên trang...`);

        // Đóng tab báo nếu còn mở từ lần cũ
        if (this.reputationPage && !this.reputationPage.isClosed()) {
            await this.reputationPage.close().catch(() => { });
            this.reputationPage = null;
        }

        const end = Date.now() + durationMs;
        while (Date.now() < end && !this.isKilled) {
            // Di chuyển chuột ngẫu nhiên trên trang hiện tại
            if (this.page && !this.page.isClosed()) {
                try {
                    const x = 200 + Math.floor(Math.random() * 1500);
                    const y = 150 + Math.floor(Math.random() * 700);
                    await this.page.mouse.move(x, y);
                } catch (e) { /* page may have closed */ }
            }
            // Chờ 10–20 giây giữa mỗi lần di chuyển
            const waitMs = 10000 + Math.floor(Math.random() * 10000);
            await this.sleep(Math.min(waitMs, Math.max(0, end - Date.now())));
        }

        this.log('[Recovery Rest] Nghỉ xong. Tiếp tục pipeline...');
    }
    async checkNewProject() {
        // Obsolete as we reload the page entirely now, but keep for compatibility if called elsewhere
    }

    // handleDownload() — REMOVED: Dead code. Download now handled inline in
    // waitAndDownload() step 9f using page.waitForEvent('download') + download.saveAs().


    async clearAllCookies(page = null) {
        this.log('[Worker] Clearing all cookies, cache, and browsing history via file-level profile cleanup (All time)...');
        try {
            // 1. Close browser completely to release locks
            this.log('[Worker] Closing browser before deep file clean...');
            await this.close(true);

            // Wait 1 second to release OS locks
            await this.sleep(1000);

            // 2. Perform deep clean of profile files (keepSession = false)
            this.log('[Worker] Purging profile directories and database files...');
            this.deepCleanProfile(false);

            // Reset state
            this.isOffline = false;
            this.settingsApplied = false;
            this._lastAppliedSettings = null;
            this._uploadedImages.clear();

            // 3. Relaunch browser
            this.log('[Worker] Relaunching browser post-clean...');
            await this.launch();
            this.log('[Worker] ✓ Browser successfully relaunched with fully cleared profile.');
        } catch (e) {
            this.log('[Worker] Error during file-level cookie clear and restart: ' + e.message);
        }
    }

    async clearGoogleLabsCookies(page) {
        this.log('[Worker] Clearing Google Labs specific cookies and session state to resolve 403...');
        const targetPage = page || this.page;
        if (!targetPage) return;
        try {
            const context = targetPage.context();
            const allCookies = await context.cookies();
            this.log(`[Worker] Total cookies before filter: ${allCookies.length}`);

            // Filter out cookies belonging to labs.google / flow.google domains 
            // OR containing flow/labs/fx/sundial/flo in their names
            const cookiesToKeep = allCookies.filter(c => {
                const domain = (c.domain || '').toLowerCase();
                const name = (c.name || '').toLowerCase();

                const isLabsDomain = domain.includes('labs.google') ||
                    domain.includes('flow.google') ||
                    domain.includes('aisandbox-pa.googleapis.com');
                const isLabsName = name.includes('flow') ||
                    name.includes('labs') ||
                    name.includes('fx') ||
                    name.includes('sundial') ||
                    name.startsWith('__secure-flo');

                return !isLabsDomain && !isLabsName;
            });

            // Clear all cookies first, then re-add the kept ones
            await context.clearCookies();
            if (cookiesToKeep.length > 0) {
                await context.addCookies(cookiesToKeep);
                this.log(`[Worker] Cleared labs.google/flow.google cookies. Retained ${cookiesToKeep.length} main Google auth cookies.`);
            } else {
                this.log('[Worker] No main cookies retained, cookie jar was fully cleared.');
            }

            // KEEP localStorage, IndexedDB, ServiceWorker, CacheStorage intact!
            // Google Flow stores session state in these — clearing them causes
            // session inconsistencies that trigger fresh 403 on next request.
            // Only clearing cookies above is sufficient to resolve stale 403s.
            this.log('[Worker] Kept localStorage/IndexedDB/ServiceWorker intact to preserve session state.');

            // Clear browser cache and browsing history via CDP (All time)
            try {
                const cdp = await context.newCDPSession(targetPage);
                await cdp.send('Network.clearBrowserCache').catch(() => { });
                await cdp.send('Storage.clearDataForOrigin', {
                    origin: 'https://labs.google',
                    storageTypes: 'all'
                }).catch(() => { });
                await cdp.detach().catch(() => { });
            } catch (cdpErr) {
                this.log(`[Worker] CDP cache/history clear warning: ${cdpErr.message}`);
            }

            this.log('[Worker] ✓ Labs storage, Service Workers, IndexedDB, cache, and history cleared.');
        } catch (e) {
            this.log('[Worker] Error clearing labs cookies: ' + e.message);
        }
    }

    async checkIfBanned(page) {
        const targetPage = page || this.page;
        if (!targetPage) return false;
        try {
            // Use visible text only to avoid false positives from raw HTML attributes/meta tags
            const hasBanText = await targetPage.evaluate(() => {
                const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
                return bodyText.includes('unusual activity') ||
                    bodyText.includes('hoạt động bất thường') ||
                    bodyText.includes('403 forbidden') ||
                    bodyText.includes('access denied');
            }).catch(() => false);
            if (hasBanText) {
                this.log('[Worker] ⚠️ Banned state detected in visible page text.');
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async humanScroll(page) {
        if (!page || page.isClosed()) return false;
        this.log('[Scroll] Simulating human-like scrolling...');
        try {
            // Perform 2-4 scrolling actions
            const scrolls = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < scrolls; i++) {
                const direction = Math.random() > 0.3 ? 1 : -1; // mostly scroll down
                const deltaY = (150 + Math.floor(Math.random() * 250)) * direction;

                // CloakBrowser has humanized scrolling, so we can use standard page.mouse.wheel
                await page.mouse.wheel(0, deltaY);

                // Natural pause between scrolls (300ms - 800ms)
                await this.sleep(300 + Math.floor(Math.random() * 500));
            }
            return true;
        } catch (e) {
            this.log(`[Scroll] Error during human scrolling simulation: ${e.message}`);
            return false;
        }
    }

    resume() {
        this.isPausedForHuman = false;
        this.log('Resume signal received from UI. Resuming worker... ');
    }

    static clearUploadLocks() {
        for (const [key, promise] of uploadLocks.entries()) {
            uploadLocks.delete(key);
            if (typeof promise.resolve === 'function') {
                promise.resolve();
            }
        }
    }
}

module.exports = AutomationWorker;
