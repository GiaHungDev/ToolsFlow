// CloakBrowser (Playwright) automation worker for Veo3 pipeline
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { encrypt, decrypt } = require('./encryption.js');
const OTPAuth = require('otpauth');

// automationService can reload this worker while retaining cached dependencies.
// Refresh download helpers here too, including when the service itself is older.
for (const helper of ['./downloadGate', './downloadStorage']) {
    delete require.cache[require.resolve(helper)];
}
const { createDownloadGate } = require('./downloadGate');
const { saveDownloadedFile } = require('./downloadStorage');

// Flow can redirect from the legacy Labs URL to its dedicated host.
function isFlowUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && (url.hostname === 'flow.google.com' ||
            (url.hostname === 'labs.google' && /^\/fx\/(?:[a-z-]+\/)?tools\/flow(?:\/|$)/i.test(url.pathname)));
    } catch { return false; }
}
function isFlowProjectUrl(value) {
    return isFlowUrl(value) && /\/project\/[^/?#]+/.test(new URL(value).pathname);
}


// Workers are fully isolated (separate browser processes, CDP-scoped input).
// All workers run 100% parallel — no cross-worker mutex needed for pipeline.
// Each worker has its own browser + account, login is automated via CDP.
// EXCEPTION: 2FA login requires per-account coordination (TOTP codes are single-use per 30s window).

// Per-account login lock: prevents multiple workers from simultaneously attempting
// 2FA login with the same TOTP code. Key = accountId, Value = { locked, lastLoginAt, lastLoginWorkerId, queue }
const _accountLoginLocks = new Map();

// Helper to wrap promise with timeout to prevent infinite hanging
const { waitForBrowserLaunch: withTimeout } = require('./browserLaunch');


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
        this.fallbackToProModel = false;

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
        const message = `[Worker ${this.id}] ${msg}`;
        this.io.emit('log', message);
    }

    async saveAuthCookiesToDisk() {
        if (!this.browser) return;
        try {
            const contexts = this.browser.contexts ? this.browser.contexts() : (this.browser.pages ? [this.browser] : []);
            const ctx = contexts.length > 0 ? contexts[0] : this.browser;
            if (ctx && typeof ctx.cookies === 'function') {
                const allCookies = await ctx.cookies();
                const authCookies = allCookies.filter(c =>
                    ['SID', 'HSID', 'SSID', 'APISID', 'SAPISID', 'OSID'].includes(c.name) ||
                    c.name.startsWith('__Secure-')
                );
                if (authCookies.length > 0) {
                    const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
                    const accountProfileName = this.accountData.profilePath || `profile_${this.id}`;
                    const cookieFilePath = path.join(baseDir, accountProfileName, `auth-cookies-w${this.id}.json`);
                    const dir = path.dirname(cookieFilePath);
                    if (!fs.existsSync(dir)) {
                        fs.mkdirSync(dir, { recursive: true });
                    }
                    fs.writeFileSync(cookieFilePath, JSON.stringify(authCookies, null, 2), 'utf8');
                    this.log(`[Cookies] Persisted ${authCookies.length} core auth cookies to ${cookieFilePath}`);
                    // Also update session account marker so account-change detection works on next launch
                    const currentEmail = (this.accountData?.email || '').trim().toLowerCase();
                    if (currentEmail && this.profilePath) {
                        const sessionAccountFile = path.join(this.profilePath, 'session-account.json');
                        try { fs.writeFileSync(sessionAccountFile, JSON.stringify({ email: currentEmail, updatedAt: new Date().toISOString() }), 'utf8'); } catch (e) {}
                    }
                }
            }
        } catch (e) {
            this.log(`[Cookies] Failed to persist cookies to disk: ${e.message}`);
        }
    }

    // ── 2FA Login Coordination Methods ──────────────────────────────────────────

    /**
     * Acquire a per-account login lock. If another worker for the same account
     * is currently logging in, this method waits until it finishes.
     * After lock release, enforces a 60s TOTP cooldown so the next worker
     * gets a fresh TOTP code window.
     */
    async _acquireAccountLoginLock(accountId) {
        if (!_accountLoginLocks.has(accountId)) {
            _accountLoginLocks.set(accountId, { locked: false, lastLoginAt: 0, lastLoginWorkerId: null });
        }
        const lock = _accountLoginLocks.get(accountId);

        if (!lock.locked) {
            lock.locked = true;
            lock.lastLoginWorkerId = this.id;
            this._holdsLoginLock = true;
            this.log(`[2FA Lock] Acquired login lock for account ${accountId}`);

            // If another worker logged in recently, wait for TOTP window to rotate (60s)
            const timeSinceLastLogin = Date.now() - lock.lastLoginAt;
            const TOTP_COOLDOWN_MS = 60 * 1000;
            if (lock.lastLoginAt > 0 && timeSinceLastLogin < TOTP_COOLDOWN_MS) {
                const waitMs = TOTP_COOLDOWN_MS - timeSinceLastLogin;
                this.log(`[2FA Lock] Waiting ${Math.ceil(waitMs / 1000)}s for TOTP code rotation...`);
                await this.sleep(waitMs);
            }
            return;
        }

        // Lock is held by another worker — wait for release
        this.log(`[2FA Lock] Account ${accountId} login lock held by Worker ${lock.lastLoginWorkerId}. Waiting...`);
        const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes max wait
        const start = Date.now();
        while (lock.locked) {
            if (Date.now() - start > MAX_WAIT_MS) {
                this.log(`[2FA Lock] Timeout waiting for login lock. Proceeding anyway...`);
                break;
            }
            await this.sleep(2000);
        }

        lock.locked = true;
        lock.lastLoginWorkerId = this.id;
        this._holdsLoginLock = true;
        this.log(`[2FA Lock] Acquired login lock for account ${accountId} (after wait)`);

        // Enforce TOTP cooldown after waiting
        const timeSinceLastLogin2 = Date.now() - lock.lastLoginAt;
        const TOTP_COOLDOWN_MS2 = 60 * 1000;
        if (lock.lastLoginAt > 0 && timeSinceLastLogin2 < TOTP_COOLDOWN_MS2) {
            const waitMs = TOTP_COOLDOWN_MS2 - timeSinceLastLogin2;
            this.log(`[2FA Lock] Waiting ${Math.ceil(waitMs / 1000)}s for TOTP code rotation...`);
            await this.sleep(waitMs);
        }
    }

    /**
     * Release the per-account login lock so the next queued worker can proceed.
     */
    _releaseAccountLoginLock(accountId, updateLastLogin = false) {
        const lock = _accountLoginLocks.get(accountId);
        if (lock) {
            if (lock.locked && lock.lastLoginWorkerId === this.id) {
                lock.locked = false;
                if (updateLastLogin) {
                    lock.lastLoginAt = Date.now();
                }
                this.log(`[2FA Lock] Released login lock for account ${accountId} (updateLastLogin: ${updateLastLogin})`);
            }
        }
        this._holdsLoginLock = false;
    }

    /**
     * Try to load auth cookies from a sibling worker (same account) that
     * has already logged in. Returns true if cookies were successfully injected.
     */
    async _loadCookiesFromSibling(accountId) {
        if (!this.automationService || !this.automationService.workers) return false;

        if ((this._siblingCookieAttempts || 0) >= 2) {
            this.log(`[2FA Lock] Sibling cookies already attempted ${this._siblingCookieAttempts} times. Skipping to prevent loop.`);
            return false;
        }

        const siblings = this.automationService.workers.filter(w =>
            w.accountData && w.accountData.id === accountId && w.id !== this.id && !w.isOffline
        );

        if (siblings.length === 0) return false;

        const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
        const accountProfileName = this.accountData.profilePath || `profile_${this.id}`;

        for (const sibling of siblings) {
            // Try loading sibling's cookie file
            const siblingCookiePath = path.join(baseDir, accountProfileName, `auth-cookies-w${sibling.id}.json`);
            if (!fs.existsSync(siblingCookiePath)) continue;

            try {
                const stat = fs.statSync(siblingCookiePath);
                // Only use cookies that are less than 1 hour old
                if (Date.now() - stat.mtimeMs > 60 * 60 * 1000) {
                    this.log(`[2FA Lock] Sibling W${sibling.id} cookies are too old (${Math.round((Date.now() - stat.mtimeMs) / 60000)} min). Skipping.`);
                    continue;
                }

                const content = fs.readFileSync(siblingCookiePath, 'utf8');
                const cookies = JSON.parse(content);
                if (cookies.length === 0) continue;

                // Inject into our browser context
                const contexts = this.browser.contexts ? this.browser.contexts() : (this.browser.pages ? [this.browser] : []);
                const ctx = contexts.length > 0 ? contexts[0] : this.browser;
                if (ctx && typeof ctx.addCookies === 'function') {
                    await ctx.addCookies(cookies);
                    this._siblingCookieAttempts = (this._siblingCookieAttempts || 0) + 1;
                    this.log(`[2FA Lock] Injected ${cookies.length} auth cookies from sibling Worker ${sibling.id} (attempt ${this._siblingCookieAttempts})`);
                    return true;
                }
            } catch (e) {
                this.log(`[2FA Lock] Failed to load sibling W${sibling.id} cookies: ${e.message}`);
            }
        }

        return false;
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


    /**
     * Hardware-aware Chrome memory flags.
     * Detects system RAM once → returns Chrome args to limit browser memory on low-RAM machines.
     * High-RAM machines (>64 GB) get no restrictions — full performance.
     *
     * Tiers:
     *   low  (≤32 GB RAM): aggressive limits — prevent OOM on weak machines
     *   mid  (32-64 GB):   moderate limits — balanced safety
     *   high (>64 GB):     no limits — full speed
     */
    _getMemoryFlags() {
        if (!AutomationWorker._memoryFlags) {
            const os = require('os');
            const totalGB = Math.round(os.totalmem() / (1024 ** 3));
            let tier, flags;

            if (totalGB <= 32) {
                tier = 'low';
                flags = [
                    '--renderer-process-limit=1',
                    '--js-flags=--max-old-space-size=256',
                    '--disable-gpu-compositing',
                    '--disable-accelerated-2d-canvas',
                ];
            } else if (totalGB <= 64) {
                tier = 'mid';
                flags = [
                    '--renderer-process-limit=2',
                    '--js-flags=--max-old-space-size=512',
                ];
            } else {
                tier = 'high';
                flags = [];
            }

            console.log(`[Hardware] RAM=${totalGB}GB → tier=${tier} → chromeFlags=${flags.length > 0 ? flags.join(' ') : 'none (unrestricted)'}`);
            AutomationWorker._memoryFlags = flags;
        }
        return AutomationWorker._memoryFlags;
    }

    /**
     * Detect whether the machine has a discrete GPU (NVIDIA, AMD, Intel Arc).
     * Runs once → caches result. Used to decide whether Chrome should use --disable-gpu.
     *
     * Returns: { hasDiscreteGPU: boolean, gpuName: string }
     *   - hasDiscreteGPU=true  → NVIDIA/AMD/Intel Arc detected → Chrome can use GPU
     *   - hasDiscreteGPU=false → Only integrated/basic adapter → Chrome should use --disable-gpu
     */
    _detectGPU() {
        if (AutomationWorker._gpuInfo === undefined) {
            try {
                const { execSync } = require('child_process');
                let output = '';
                
                // Primary: PowerShell Get-CimInstance (works on Windows 10/11, wmic is deprecated)
                try {
                    output = execSync(
                        'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"',
                        { encoding: 'utf-8', timeout: 8000, stdio: ['pipe', 'pipe', 'ignore'] }
                    ).trim();
                } catch (_psErr) {
                    // Fallback: legacy wmic (older Windows versions)
                    output = execSync(
                        'wmic path win32_VideoController get Name /format:list',
                        { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'ignore'] }
                    ).trim();
                }

                // Parse all GPU names
                const gpuNames = output.split('\n')
                    .map(line => line.replace('Name=', '').trim())
                    .filter(name => name.length > 0);

                // Check for discrete GPUs (not just integrated/basic)
                const discreteKeywords = ['nvidia', 'geforce', 'rtx', 'gtx', 'quadro', 'tesla',
                    'radeon', 'rx ', 'vega', 'amd', 'intel arc', 'a770', 'a750', 'a580'];
                const integratedKeywords = ['microsoft basic', 'basic display', 'standard vga'];

                const hasDiscrete = gpuNames.some(name => {
                    const lower = name.toLowerCase();
                    // Skip known integrated/virtual adapters
                    if (integratedKeywords.some(k => lower.includes(k))) return false;
                    // Match known discrete GPU brands
                    return discreteKeywords.some(k => lower.includes(k));
                });

                const gpuSummary = gpuNames.join(', ') || 'none detected';
                console.log(`[Hardware] GPU detected: ${gpuSummary} → hasDiscreteGPU=${hasDiscrete}`);
                AutomationWorker._gpuInfo = { hasDiscreteGPU: hasDiscrete, gpuName: gpuSummary };
            } catch (e) {
                // Both PowerShell and WMI failed → assume no GPU to be safe
                console.log(`[Hardware] GPU detection failed: ${e.message} → defaulting to --disable-gpu`);
                AutomationWorker._gpuInfo = { hasDiscreteGPU: false, gpuName: 'detection failed' };
            }
        }
        return AutomationWorker._gpuInfo;
    }

    async launch() {
        const assertRunning = () => {
            if (this.isKilled || this.automationService?.isRunning === false) throw new Error('AUTOMATION_STOPPED');
        };
        assertRunning();
        // Prevent concurrent launches — pre-warm and pipeline may call simultaneously
        if (this._launching) {
            const timeSinceLaunch = Date.now() - (this._launchedAt || 0);
            if (timeSinceLaunch > 5 * 60 * 1000) { // 5 minutes safety net
                this.log(`[Safety Net] Previous launch is stuck for ${Math.round(timeSinceLaunch / 1000)}s. Resetting flag and proceeding.`);
                this._launching = false;
            } else {
                this.log('Launch already in progress, waiting for completion...');
                while (this._launching) {
                    await new Promise(r => setTimeout(r, 500));
                }
                return;
            }
        }
        this._siblingCookieAttempts = this._siblingCookieAttempts || 0;
        this._launching = true;
        this._launchedAt = Date.now();

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
                    const { execFile } = require('child_process');
                    const { promisify } = require('util');
                    const execFileAsync = promisify(execFile);
                    // Use PowerShell to find PIDs matching this profile path, then force-kill each
                    const escaped = this.profilePath.replace(/'/g, "''").toLowerCase();
                    const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${escaped}') } | Select-Object -ExpandProperty ProcessId`;
                    
                    const { stdout } = await Promise.race([
                        execFileAsync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf-8' }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('zombie-cleanup-timeout')), 5000))
                    ]);
                    
                    const pidOutput = (stdout || '').trim();
                    if (pidOutput) {
                        const pids = pidOutput.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
                        for (const pid of pids) {
                            try {
                                await Promise.race([
                                    execFileAsync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' }),
                                    new Promise((_, reject) => setTimeout(() => reject(new Error('taskkill-timeout')), 3000))
                                ]);
                                this.log(`Killed zombie browser PID ${pid} for profile ${this.profilePath}`);
                            } catch (e) { /* process may have already exited or timed out */ }
                        }
                        // Wait briefly for OS to release lock files
                        await new Promise(r => setTimeout(r, 500));
                    }
                } catch (e) { /* non-fatal: no matching processes or timeout */ }
                // Also remove stale lock files left by crashed Chromium
                const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
                for (const lf of lockFiles) {
                    const lockPath = require('path').join(this.profilePath, lf);
                    try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch (e) { }
                }
                // Always wait briefly to let the OS release file locks completely
                await new Promise(r => setTimeout(r, 1000));
            }



            this.log(`Launching CloakBrowser for account ${this.accountData?.email || this.id}...`);

            if (!fs.existsSync(this.profilePath)) {
                fs.mkdirSync(this.profilePath, { recursive: true });
            }

            // Tự động đồng bộ hóa session từ anchor profile nếu chạy isolated (nhiều worker) và profile của worker chưa tồn tại
            if (this.profilePath !== this.anchorProfilePath && !this.useNativeChromeProfile) {
                const workerDefault = path.join(this.profilePath, 'Default');
                if (!fs.existsSync(workerDefault)) {
                    await this.syncSessionFromAnchor();
                } else {
                    this.log('[Session Sync] Thư mục Default của Worker Profile đã tồn tại — bỏ qua sao chép để tránh tranh chấp file lock.');
                }
            }

            // Pre-launch cleanup — skip for Chrome native profiles (don't touch user's real profile)
            const BrowserPool = require('./browserPool.js');
            if (!this.useNativeChromeProfile) {
                // ── Account Mismatch Detection ──
                // Check if the current account email matches the last session's email.
                // If the admin changed the linked account, the old session (cookies, storage)
                // belongs to a different Google account and must be purged to force re-login.
                let accountChanged = false;
                const sessionAccountFile = path.join(this.profilePath, 'session-account.json');
                const currentEmail = (this.accountData?.email || '').trim().toLowerCase();
                if (currentEmail && fs.existsSync(sessionAccountFile)) {
                    try {
                        const savedData = JSON.parse(fs.readFileSync(sessionAccountFile, 'utf8'));
                        const savedEmail = (savedData.email || '').trim().toLowerCase();
                        if (savedEmail && savedEmail !== currentEmail) {
                            accountChanged = true;
                            this.log(`[Account Change] Phát hiện thay đổi tài khoản: ${savedEmail} → ${currentEmail}. Xóa session cũ để đăng nhập lại...`);
                            // Full clean: purge ALL session data (cookies, storage, login data)
                            this.deepCleanProfile(false);
                            // Also delete saved auth cookies files for this worker
                            const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
                            const accountProfileName = this.accountData.profilePath || `profile_${this.id}`;
                            const cookieFilePath = path.join(baseDir, accountProfileName, `auth-cookies-w${this.id}.json`);
                            try { if (fs.existsSync(cookieFilePath)) fs.unlinkSync(cookieFilePath); } catch (e) {}
                            // Clear legacy cookie path
                            const legacyCookiePath = path.join(this.profilePath, 'auth-cookies.json');
                            try { if (fs.existsSync(legacyCookiePath)) fs.unlinkSync(legacyCookiePath); } catch (e) {}
                            // Clear in-memory saved cookies so they won't be re-injected
                            this._savedAuthCookies = null;
                            // Update the marker file with the new email
                            try { fs.writeFileSync(sessionAccountFile, JSON.stringify({ email: currentEmail, updatedAt: new Date().toISOString() }), 'utf8'); } catch (e) {}
                            this.log(`[Account Change] Session cũ đã được xóa sạch. Sẵn sàng đăng nhập tài khoản mới: ${currentEmail}`);
                        }
                    } catch (e) {
                        // Corrupted file — ignore and continue
                    }
                }
                // Save/update the session account marker if it doesn't exist yet
                if (currentEmail && !fs.existsSync(sessionAccountFile)) {
                    try { fs.writeFileSync(sessionAccountFile, JSON.stringify({ email: currentEmail, updatedAt: new Date().toISOString() }), 'utf8'); } catch (e) {}
                }

                BrowserPool.removeUnsafeExtensions(this.profilePath, (msg) => this.log(msg));
                BrowserPool.injectPreferences(this.profilePath);
                // Deep-clean transient data (cache, storage, cookies) every launch
                // Ensures each browser session starts fresh — prevents memory bloat
                // Skip if account changed — already did a full clean above
                if (!accountChanged) {
                    this.deepCleanProfile();
                }
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

            // Visibility controls from ConfigManager / accountData
            const cfg = this.automationService && this.automationService.configManager ? this.automationService.configManager.getConfig() : {};
            const accountHeadless = this.accountData?.headless;
            const isHeadless = accountHeadless !== undefined ? (accountHeadless !== false && accountHeadless !== 0 && accountHeadless !== 'false') : (cfg.headless !== false);
            const isHidden = accountHeadless !== undefined ? (accountHeadless !== false && accountHeadless !== 0 && accountHeadless !== 'false') : (cfg.visibility !== 'visible');
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
                    // Dynamic memory flags — applied based on system RAM (see _getMemoryFlags)
                    ...this._getMemoryFlags(),
                ],
            };

            // GPU-aware flag: disable GPU acceleration on machines without discrete GPU
            // This prevents Chrome exitCode=21 crashes caused by GPU driver issues on integrated/basic adapters
            const gpuInfo = this._detectGPU();
            if (!gpuInfo.hasDiscreteGPU) {
                launchOptions.args.push('--disable-gpu');
                this.log(`[Hardware] No discrete GPU detected (${gpuInfo.gpuName}). Added --disable-gpu to prevent Chrome init crashes.`);
            }

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

            // GPU-aware timeout: integrated GPU machines are much slower to init Chrome
            const launchTimeoutMs = gpuInfo.hasDiscreteGPU ? 60000 : 120000;

            // Launch CloakBrowser (Playwright-based)
            try {
                const { launchPersistentContext } = await import('cloakbrowser');
                assertRunning();
                const context = await withTimeout(
                    launchPersistentContext(launchOptions),
                    launchTimeoutMs,
                    `CloakBrowser launch timeout (attempt 1) after ${launchTimeoutMs / 1000}s`,
                    () => this.isKilled || this.automationService?.isRunning === false
                );

                this.browser = context;
                if (this.isKilled || this.automationService?.isRunning === false) {
                    await context.close().catch(() => {});
                    this.browser = null;
                    throw new Error('AUTOMATION_STOPPED');
                }
                this.log(`CloakBrowser launched with fingerprint seed: ${profileSeed}`);

            } catch (firstErr) {
                assertRunning();
                const isInitCrash = firstErr.message.includes('exitCode=21') || firstErr.message.includes('exitCode=133');
                const isProfileLock = firstErr.message.includes('existing browser session') || firstErr.message.includes('SingletonLock');
                this.log(`CloakBrowser launch failed (attempt 1): ${firstErr.message}. ` +
                    `[Type: ${isInitCrash ? 'CHROME_INIT_CRASH' : isProfileLock ? 'PROFILE_LOCKED' : 'UNKNOWN'}] Cleaning up and retrying...`);

                // Full cleanup: kill zombie Chrome processes holding this profile's locks
                if (this.profilePath) {
                    try {
                        const { execFile } = require('child_process');
                        const { promisify } = require('util');
                        const execFileAsync = promisify(execFile);
                        const escaped = this.profilePath.replace(/'/g, "''").toLowerCase();
                        const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${escaped}') } | Select-Object -ExpandProperty ProcessId`;

                        const { stdout } = await Promise.race([
                            execFileAsync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf-8' }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('zombie-cleanup-timeout')), 5000))
                        ]);

                        const pidOutput = (stdout || '').trim();
                        if (pidOutput) {
                            const pids = pidOutput.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
                            for (const pid of pids) {
                                try {
                                    await Promise.race([
                                        execFileAsync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' }),
                                        new Promise((_, reject) => setTimeout(() => reject(new Error('taskkill-timeout')), 3000))
                                    ]);
                                    this.log(`[Retry Cleanup] Killed zombie browser PID ${pid}`);
                                } catch (e) { /* already exited or timed out */ }
                            }
                        }
                    } catch (e) { /* non-fatal */ }

                    // exitCode=21: Chrome crashed during initialization.
                    // #1 cause on Windows: corrupted GPUCache or ShaderCache in profile.
                    // Clean these so retry has a fresh GPU state.
                    if (isInitCrash) {
                        const cacheDirs = ['GPUCache', 'ShaderCache', 'GrShaderCache', 'Default/GPUCache', 'Default/ShaderCache'];
                        for (const dir of cacheDirs) {
                            const dirPath = path.join(this.profilePath, dir);
                            try {
                                if (fs.existsSync(dirPath)) {
                                    fs.rmSync(dirPath, { recursive: true, force: true });
                                    this.log(`[Retry Cleanup] Deleted corrupted ${dir} from profile.`);
                                }
                            } catch (e) { /* non-fatal */ }
                        }
                    }
                }

                // Clean lock files + wait for OS to fully release handles
                BrowserPool.cleanStaleLocks(this.profilePath);
                await new Promise(r => setTimeout(r, 3000));

                try {
                    const { launchPersistentContext } = await import('cloakbrowser');
                    assertRunning();

                    // Create a fresh copy of launchOptions for retry — avoid mutating original
                    const retryOptions = { ...launchOptions, args: [...launchOptions.args] };

                    // exitCode=21: add --disable-gpu as fallback for the retry only.
                    // This does NOT affect Veo3 generation (server-side).
                    // It only affects Chrome's own page rendering pipeline.
                    // Máy có GPU vẫn chạy bình thường ở lần launch đầu tiên.
                    if (isInitCrash && !retryOptions.args.includes('--disable-gpu')) {
                        retryOptions.args.push('--disable-gpu');
                        this.log('[Retry] Added --disable-gpu fallback (Chrome init crash detected). This only affects browser rendering, NOT Veo3 generation.');
                    }

                    this.log('Retrying CloakBrowser launch (attempt 2)...');
                    const context = await withTimeout(
                        launchPersistentContext(retryOptions),
                        launchTimeoutMs,
                        `CloakBrowser launch timeout (attempt 2) after ${launchTimeoutMs / 1000}s`,
                        () => this.isKilled || this.automationService?.isRunning === false
                    );
                    this.browser = context;
                    if (this.isKilled || this.automationService?.isRunning === false) {
                        await context.close().catch(() => {});
                        this.browser = null;
                        throw new Error('AUTOMATION_STOPPED');
                    }
                    this.log('CloakBrowser launched successfully on retry.');
                } catch (retryErr) {
                    assertRunning();
                    this.log(`CloakBrowser retry also failed: ${retryErr.message}`);
                    if (!this.useNativeChromeProfile && this.profilePath) {
                        try {
                            if (fs.existsSync(this.profilePath)) {
                                fs.rmSync(this.profilePath, { recursive: true, force: true });
                                this.log(`[Launch Failure] Cleared corrupted profile folder: ${this.profilePath}`);
                            }
                        } catch (cleanErr) {
                            this.log(`[Launch Failure] Warning: failed to clean profile folder: ${cleanErr.message}`);
                        }
                    }
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
            const thisContext = this.browser; // Capture reference to THIS browser context
            this.browser.on('close', () => {
                // Guard: ignore stale close events from OLD browser context.
                // Only react if THIS context is still active.
                if (this.browser !== thisContext) {
                    this.log('Browser close event from stale context. Ignoring.');
                    return;
                }
                this.io.emit('worker-status', { id: this.id, status: 'offline' });
                this.log('Browser closed. Worker offline.');
                // QUAN TRỌNG: Set isOffline TRƯỚC isBusy để tránh race condition
                // với Orchestrator._processQueue() — nó check cả 2 flag cùng lúc.
                // Nếu set isBusy=false trước, Orchestrator có thể dispatch job mới
                // vào worker đang offline trong khoảnh khắc trước khi isOffline=true.
                this.isOffline = true;
                this.isBusy = false;
            });

            // Load cookies from disk if in-memory is empty
            if (!this._savedAuthCookies || this._savedAuthCookies.length === 0) {
                const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
                const accountProfileName = this.accountData.profilePath || `profile_${this.id}`;
                const cookieFilePath = path.join(baseDir, accountProfileName, `auth-cookies-w${this.id}.json`);
                if (fs.existsSync(cookieFilePath)) {
                    try {
                        const content = fs.readFileSync(cookieFilePath, 'utf8');
                        this._savedAuthCookies = JSON.parse(content);
                        this.log(`[Launch] Loaded ${this._savedAuthCookies.length} auth cookies from disk file.`);
                    } catch (err) {
                        this.log(`[Launch] Error reading cookies from disk: ${err.message}`);
                    }
                } else {
                    // Fallback to legacy path inside profilePath for backward compatibility
                    const legacyPath = path.join(this.profilePath, 'auth-cookies.json');
                    if (fs.existsSync(legacyPath)) {
                        try {
                            const content = fs.readFileSync(legacyPath, 'utf8');
                            this._savedAuthCookies = JSON.parse(content);
                            this.log(`[Launch] Loaded ${this._savedAuthCookies.length} auth cookies from legacy disk file.`);
                        } catch (err) { /* ignore */ }
                    }
                }
            }

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
                            const inActiveProject = isFlowProjectUrl(currentUrl);

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

            // Failsafe: Auto-close ANY unwanted new tabs to prevent GPU memory bloat
            // (6 workers × leaked tabs = 20+ tabs → GPU exhaustion)
            this.browser.on('page', async (newPage) => {
                try {
                    // Poll URL for up to 5 seconds to handle slow redirects/auth flows
                    let url = '';
                    for (let i = 0; i < 10; i++) {
                        if (newPage.isClosed()) return;
                        if (newPage === this.blankPage || newPage === this.page || newPage === this.reputationPage) return;
                        
                        url = newPage.url() || '';
                        
                        // If it has loaded a whitelisted URL, keep it and return immediately
                        if (
                            isFlowUrl(url) ||
                            url.includes('accounts.google.com') ||
                            url.startsWith('chrome-extension://')
                        ) {
                            return;
                        }
                        
                        await new Promise(r => setTimeout(r, 500));
                    }
                    
                    // Final check before closing
                    if (newPage === this.blankPage || newPage === this.page || newPage === this.reputationPage) return;
                    if (newPage.isClosed()) return;
                    
                    this.log(`[Tab Guard] Auto-closing leaked/unwanted tab: ${url.substring(0, 80)}`);
                    await newPage.close().catch(() => { });
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
                let raceTimerId;
                clicked = await Promise.race([
                    frame.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                        const spans = Array.from(document.querySelectorAll('span, div'));
                        const allEls = [...btns, ...spans];

                        for (const el of allEls) {
                            const t = (el.textContent || '').trim().toLowerCase();
                            if (t === 'sign in with google' || t === 'đăng nhập bằng google') {
                                const clickable = el.closest('button, [role="button"]') || el;
                                const r = clickable.getBoundingClientRect();
                                if (r.width > 0 && r.height > 0) {
                                    return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5), source: 'google-identity' };
                                }
                            }
                        }

                        // AuthJS / NextAuth "Sign in with Google" page detection
                        const authJsBtn = document.querySelector('button img[src*="authjs.dev"]');
                        if (authJsBtn) {
                            const clickable = authJsBtn.closest('button') || authJsBtn;
                            const r = clickable.getBoundingClientRect();
                            if (r.width > 0 && r.height > 0) {
                                return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5), source: 'authjs' };
                            }
                        }
                        return null;
                    }),
                    new Promise((_, reject) => { raceTimerId = setTimeout(() => reject(new Error('SESSION_CHECK_TIMEOUT')), 10000); })
                ]).catch(() => null).finally(() => clearTimeout(raceTimerId));

                if (clicked) {
                    const source = clicked.source || 'unknown';
                    this.log(`Detected session drop (${source}). Auto-clicking "Sign in with Google"...`);
                    await this.humanClick(this.page, clicked.x, clicked.y);
                    await this.sleep(3000 + Math.random() * 2000); // Give OAuth redirect time to process
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
        if (this.isKilled || this.automationService?.isRunning === false) throw new Error('AUTOMATION_STOPPED');
        this.log(`[Restart] Starting full browser restart. Reason: ${reason}`);
        this.isLaunching = true;
        try {

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
                    await this.saveAuthCookiesToDisk();
                }
            } catch (e) {
                this.log(`[Restart] Warning: Failed to extract cookies before close: ${e.message}`);
            }
        } else if (clearCookies) {
            this.log(`[Restart] Cookies marked for clear. Skipping cookie saving.`);
            this._savedAuthCookies = null;
            try {
                const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
                const accountProfileName = this.accountData.profilePath || `profile_${this.id}`;
                const cookieFilePath = path.join(baseDir, accountProfileName, `auth-cookies-w${this.id}.json`);
                if (fs.existsSync(cookieFilePath)) {
                    fs.unlinkSync(cookieFilePath);
                    this.log(`[Restart] Deleted relocated cookie file: ${cookieFilePath}`);
                }
            } catch (e) {
                this.log(`[Restart] Warning: Failed to delete relocated cookie file: ${e.message}`);
            }
        }

        // 2. Close browser completely (kills process, cleans locks)
        await this.close(true);

        // Đợi OS nhả file lock sau khi kill browser processes
        await this.sleep(1500);

        // 2b. Nếu clearCookies = true, tiến hành dọn dẹp sâu thư mục profile (cookie, lịch sử, local storage...)
        if (clearCookies) {
            this.log(`[Restart] clearCookies is true. Performing deepCleanProfile(false) to purge cookies/history/storage...`);
            try {
                this.deepCleanProfile(false);
            } catch (cleanErr) {
                this.log(`[Restart] Warning during deepCleanProfile(false): ${cleanErr.message}`);
            }
        }

        // 3. Always delete the entire root profile folder to ensure clean slate (unless useNativeChromeProfile)
        if (!this.useNativeChromeProfile && this.profilePath) {
            this.log(`[Restart] Deleting entire root profile folder: ${this.profilePath}`);
            // Retry with increasing delays — Windows may not release file handles immediately after taskkill
            let deleted = false;
            for (let attempt = 1; attempt <= 4 && !deleted; attempt++) {
                try {
                    if (fs.existsSync(this.profilePath)) {
                        fs.rmSync(this.profilePath, { recursive: true, force: true });
                    }
                    deleted = true;
                    this.log(`[Restart] ✓ Profile folder deleted (attempt ${attempt}).`);
                } catch (rmErr) {
                    this.log(`[Restart] Warning: Delete attempt ${attempt}/4 failed: ${rmErr.code || rmErr.message}`);
                    if (attempt < 4) {
                        // Wait longer each retry: 1.5s, 3s, 4.5s
                        await this.sleep(1500 * attempt);
                        // Try force-killing any remaining chrome processes holding locks
                        if (attempt === 2 && this.profilePath) {
                            try {
                                const escaped = this.profilePath.replace(/\\/g, '\\\\').toLowerCase();
                                require('child_process').execSync(
                                    `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('${escaped}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
                                    { stdio: 'ignore', timeout: 5000 }
                                );
                                this.log(`[Restart] Killed remaining processes holding locks on profile.`);
                            } catch (killErr) { /* non-fatal */ }
                        }
                    }
                }
            }
            if (!deleted && fs.existsSync(this.profilePath)) {
                this.isOffline = true;
                this.io.emit('worker-status', { id: this.id, status: 'offline' });
                throw new Error(`[Restart] EPERM: Failed to delete locked profile directory: ${this.profilePath}. Aborting browser launch.`);
            }
        }

        // 4. Reset state
        this.isOffline = false;
        this.settingsApplied = false;
        this._lastAppliedSettings = null;
        this._uploadedImages.clear();
        this._siblingCookieAttempts = 0;
        this.lastSuccessfulDownloadAt = Date.now(); // Reset 15-min download timeout

        // 5. Re-launch browser (new fingerprint) + login from scratch
        await this.launch();
        this.log(`[Restart] ✓ Browser restarted with new fingerprint. Reason: ${reason}`);
        } finally {
            this.isLaunching = false;
        }
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

            const copyWithRetry = async (src, dest, isDir) => {
                let lastError = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        // Clean up destination first to prevent EACCES/permission issues on overwrite
                        if (fs.existsSync(dest)) {
                            try {
                                fs.rmSync(dest, { recursive: true, force: true });
                            } catch (_) {}
                        }
                        if (isDir) {
                            if (typeof fs.cpSync === 'function') {
                                fs.cpSync(src, dest, { recursive: true, force: true, errorOnExist: false });
                            } else {
                                const copyRecursiveSync = (s, d) => {
                                    const exists = fs.existsSync(s);
                                    const stats = exists && fs.statSync(s);
                                    const isDirectory = exists && stats.isDirectory();
                                    if (isDirectory) {
                                        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
                                        fs.readdirSync(s).forEach((childItemName) => {
                                            copyRecursiveSync(path.join(s, childItemName), path.join(d, childItemName));
                                        });
                                    } else {
                                        fs.copyFileSync(s, d);
                                    }
                                };
                                copyRecursiveSync(src, dest);
                            }
                        } else {
                            fs.copyFileSync(src, dest);
                        }
                        return; // Success!
                    } catch (err) {
                        lastError = err;
                        if (attempt < 3) {
                            const delay = 500 * attempt;
                            await new Promise(r => setTimeout(r, delay));
                        }
                    }
                }
                throw lastError;
            };

            for (const item of itemsToSync) {
                const srcPath = path.join(anchorDefault, item.name);
                const destPath = path.join(workerDefault, item.name);

                if (fs.existsSync(srcPath)) {
                    try {
                        await copyWithRetry(srcPath, destPath, item.isDir);
                    } catch (e) {
                        this.log(`[Session Sync] Warning/Error trong quá trình đồng bộ "${item.name}" (Bỏ qua và tiếp tục): ${e.message}`);
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

            this.log(`[Session Sync] ✓ Đồng bộ hóa session thành công!`);
        } catch (err) {
            this.log(`[Session Sync] Warning/Error trong quá trình đồng bộ: ${err.message}`);
        }
    }

    /**
     * Safe evaluate wrapper: catches context destruction during navigation
     * and retries after waiting for the page to stabilize.
     */
    async safeEvaluate(page, fn, args, retries = 2) {
        for (let i = 0; i <= retries; i++) {
            let timeoutId;
            try {
                const evalPromise = page.evaluate(fn, args);
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error('EVALUATE_TIMEOUT: page.evaluate hung for more than 15s')), 15000);
                });
                const result = await Promise.race([evalPromise, timeoutPromise]);
                clearTimeout(timeoutId);
                return result;
            } catch (e) {
                if (timeoutId) clearTimeout(timeoutId);
                const msg = e.message || '';
                if (msg.includes('Execution context was destroyed') ||
                    msg.includes('navigation') ||
                    msg.includes('context destroyed') ||
                    msg.includes('EVALUATE_TIMEOUT')) {
                    if (i < retries) {
                        this.log(`[SafeEval] Evaluation issue (${msg}). Waiting 2s to settle (retry ${i + 1}/${retries})...`);
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
        const accountId = this.accountData.id || this.id;
        try {
            this.log('Navigating to Veo3 for login check...');
            await targetPage.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(err => {
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
                    // NOTE: "Create with Google Flow" is NOT a login signal!
                    // It appears on the PUBLIC landing page (no session) too.
                    // Only use signals that confirm an authenticated session.

                    // Fast signals: user avatar (renders immediately in header)
                    const hasUserAvatar = !!document.querySelector('img[src*="googleusercontent.com"]');
                    return hasNewProject || hasUserAvatar ||
                        !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                });
            };

            let isLoggedIn = false;
            let currentUrl = await targetPage.url();

            // Poll for workspace/gallery elements — gallery cards load async after page shell
            // Retry up to 4 times (~8-10s total) if URL stays on Flow (not redirected to login)
            for (let pollAttempt = 1; pollAttempt <= 4; pollAttempt++) {
                isLoggedIn = await checkWorkspaceOrGallery();
                currentUrl = await targetPage.url();
                if (isLoggedIn) {
                    this.log(`[Login] ✓ Session detected on attempt ${pollAttempt}/4. Already logged in.`);
                    break;
                }
                // If redirected to Google login, no point retrying
                if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin') || currentUrl.includes('AccountChooser')) {
                    this.log(`[Login] Redirected to login page. Skipping retry.`);
                    break;
                }
                if (pollAttempt < 4) {
                    await this.sleep(2000 + Math.random() * 500);
                }
            }

            // If we are already logged in to Google but on the intermediate myaccount page, redirect to Flow
            if (!isLoggedIn && currentUrl.includes('myaccount.google.com')) {
                this.log('Already logged in to Google but on Account page. Redirecting to Flow...');
                await targetPage.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await this.sleep(1500 + Math.random() * 1000);
                isLoggedIn = await checkWorkspaceOrGallery();
                currentUrl = await targetPage.url();
            }

            // If we are on the Intro page, try to click the button to see if we can enter the gallery automatically
            if (!isLoggedIn && isFlowUrl(currentUrl)) {
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
                    // Wait for workspace to load after clicking intro CTA — retry up to 3 times
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        await this.sleep(2000 + Math.random() * 1000);
                        isLoggedIn = await checkWorkspaceOrGallery();
                        currentUrl = await targetPage.url();
                        if (isLoggedIn || currentUrl.includes('accounts.google.com')) break;
                        if (attempt < 3) this.log(`[Login] Workspace not ready after CTA click (attempt ${attempt}/3), waiting...`);
                    }
                    // If still on Flow URL (not redirected to login), treat as logged in
                    if (!isLoggedIn && isFlowUrl(currentUrl) && !currentUrl.includes('accounts.google.com')) {
                        this.log('[Login] Still on Flow page after CTA click — treating as logged in (session valid).');
                        isLoggedIn = true;
                    }
                }
            }

            // ── Account Email Verification ──
            // After detecting a valid session, verify the logged-in Google account
            // matches the expected account. If the admin changed the linked account,
            // the old session might still be active under a different email.
            if (isLoggedIn && this.accountData?.email && !currentUrl.includes('accounts.google.com')) {
                const expectedEmail = this.accountData.email.trim().toLowerCase();
                let actualEmail = null;

                try {
                    // Method 1: Read email from Google Account button aria-label
                    // Format: "Google Account: Display Name (email@gmail.com)"
                    actualEmail = await this.safeEvaluate(targetPage, () => {
                        // Check aria-label on account button
                        const accountBtn = document.querySelector('a[aria-label*="Google Account"]');
                        if (accountBtn) {
                            const label = accountBtn.getAttribute('aria-label') || '';
                            const match = label.match(/\(([^)]+@[^)]+)\)/);
                            if (match) return match[1].trim().toLowerCase();
                        }
                        return null;
                    }).catch(() => null);

                    // Method 2: If aria-label not found, click account button and read from panel
                    if (!actualEmail) {
                        // Try clicking the account avatar/button to open account panel
                        const avatarClicked = await this.safeEvaluate(targetPage, () => {
                            // Look for the account button with class patterns from Google header
                            const btn = document.querySelector('a[aria-label*="Google Account"]') ||
                                        document.querySelector('.header-user-button') ||
                                        document.querySelector('[data-ogsr-up] a[role="button"]');
                            if (btn) {
                                const r = btn.getBoundingClientRect();
                                if (r.width > 0 && r.height > 0) {
                                    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                                }
                            }
                            return null;
                        }).catch(() => null);

                        if (avatarClicked) {
                            await this.humanClick(targetPage, avatarClicked.x, avatarClicked.y, { reason: 'account_verify_click' });
                            await this.sleep(1500 + Math.random() * 500);

                            // Read email from account panel
                            actualEmail = await this.safeEvaluate(targetPage, () => {
                                // Method 2a: user-email span in account panel
                                const emailSpan = document.querySelector('.user-email');
                                if (emailSpan && emailSpan.textContent) return emailSpan.textContent.trim().toLowerCase();
                                // Method 2b: Look for email pattern in account info container
                                const infoContainer = document.querySelector('.user-info-container, .user-details');
                                if (infoContainer) {
                                    const spans = infoContainer.querySelectorAll('span');
                                    for (const s of spans) {
                                        const text = (s.textContent || '').trim();
                                        if (text.includes('@') && text.includes('.')) return text.toLowerCase();
                                    }
                                }
                                return null;
                            }).catch(() => null);

                            // Close the panel by clicking elsewhere (press Escape)
                            await targetPage.keyboard.press('Escape').catch(() => {});
                            await this.sleep(500);
                        }
                    }
                } catch (e) {
                    this.log(`[Account Verify] Error checking logged-in email: ${e.message}`);
                }

                if (actualEmail && actualEmail !== expectedEmail) {
                    this.log(`[Account Mismatch] ⚠️ Browser đang đăng nhập tài khoản ${actualEmail} nhưng cần ${expectedEmail}. Đang xóa session cũ và đăng nhập lại...`);

                    // 1. Clear all browser cookies
                    try {
                        await this.browser.clearCookies();
                        this.log('[Account Mismatch] Đã xóa toàn bộ cookies trình duyệt.');
                    } catch (e) {
                        this.log(`[Account Mismatch] Lỗi khi xóa cookies: ${e.message}`);
                    }

                    // 2. Clear in-memory saved cookies
                    this._savedAuthCookies = null;

                    // 3. Delete saved cookie files on disk
                    try {
                        const baseDir = process.env.USER_DATA_PATH || path.resolve(__dirname, '../../user_data');
                        const accountProfileName = this.accountData.profilePath || `profile_${this.id}`;
                        const cookieFilePath = path.join(baseDir, accountProfileName, `auth-cookies-w${this.id}.json`);
                        if (fs.existsSync(cookieFilePath)) fs.unlinkSync(cookieFilePath);
                        const legacyCookiePath = path.join(this.profilePath, 'auth-cookies.json');
                        if (fs.existsSync(legacyCookiePath)) fs.unlinkSync(legacyCookiePath);
                    } catch (e) {}

                    // 4. Update session-account marker
                    try {
                        const sessionAccountFile = path.join(this.profilePath, 'session-account.json');
                        fs.writeFileSync(sessionAccountFile, JSON.stringify({ email: expectedEmail, updatedAt: new Date().toISOString() }), 'utf8');
                    } catch (e) {}

                    // 5. Sign out from Google
                    this.log('[Account Mismatch] Đang đăng xuất khỏi Google...');
                    await targetPage.goto('https://accounts.google.com/Logout', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                    await this.sleep(2000 + Math.random() * 1000);

                    // 6. Navigate back to Flow to trigger fresh login
                    await targetPage.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await this.sleep(2000 + Math.random() * 1000);

                    // 7. Force login flow
                    isLoggedIn = false;
                    currentUrl = await targetPage.url();
                    this.log(`[Account Mismatch] Session cũ đã được xóa. Bắt đầu đăng nhập tài khoản mới: ${expectedEmail}`);
                } else if (actualEmail) {
                    this.log(`[Account Verify] ✓ Tài khoản đăng nhập khớp: ${actualEmail}`);
                } else {
                    this.log(`[Account Verify] Không thể xác minh email đăng nhập — tiếp tục bình thường.`);
                }
            }

            // If not immediately logged in, check if we are on the Google Login page (or redirected there after clicking Intro CTA)
            if (!isLoggedIn || currentUrl.includes('accounts.google.com') || currentUrl.includes('AccountChooser') || currentUrl.includes('signin')) {
                this.log('[Login] Bắt đầu luồng đăng nhập...');

                let needManualLogin = false;
                let autoLoginErrorMsg = '';
                const tfaSecret = this.accountData.twoFactorSecret ? (decrypt(this.accountData.twoFactorSecret) || '').replace(/\s+/g, '') : '';

                try {
                    // Recheck: session might have been restored by cookie injection
                    isLoggedIn = await checkWorkspaceOrGallery();
                    currentUrl = await targetPage.url();
                    if (isLoggedIn && !currentUrl.includes('accounts.google.com') && !currentUrl.includes('signin') && !currentUrl.includes('AccountChooser')) {
                        this.log('[Login] Phiên đăng nhập đã được khôi phục. Bỏ qua luồng đăng nhập...');
                        return;
                    }

                    // Auto-login if credentials available, otherwise fall back to manual
                    if (!this.accountData.password) {
                        this.log('No password stored. Opening for manual login...');
                        await targetPage.goto('https://accounts.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                        await this.waitForManualLogin();
                        return;
                    }

                    this.log('Login sequence required.');

                    const email = this.accountData.email;
                    const pwd = decrypt(this.accountData.password);

                    // ── 2FA Account Lock: coordinate login across workers sharing the same account ──
                    if (tfaSecret) {
                        await this._acquireAccountLoginLock(accountId);

                        // Try loading cookies from a sibling worker that already logged in recently
                        const siblingCookiesLoaded = await this._loadCookiesFromSibling(accountId);
                        if (siblingCookiesLoaded) {
                            this._releaseAccountLoginLock(accountId);
                            // Reload page with the injected cookies to skip login
                            await targetPage.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                            await this.sleep(2000 + Math.random() * 1000);
                            // Verify we're actually logged in
                            const isLoggedInNow = await this.page.evaluate(() => {
                                const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                                const hasAvatar = !!document.querySelector('img[src*="googleusercontent.com"]');
                                const textNodes = Array.from(document.querySelectorAll('div, span, button'));
                                const hasNewProject = textNodes.some(el => el.textContent && /dự án mới|new project|create project|tạo dự án/i.test(el.textContent));
                                return hasEditor || hasAvatar || hasNewProject;
                            }).catch(() => false);
                            if (isLoggedInNow) {
                                this.log('[2FA Lock] ✓ Sibling cookies worked! Skipping 2FA login.');
                                return; // Skip entire login flow
                            }
                            this.log('[2FA Lock] Sibling cookies did not work. Proceeding with full login...');
                            // Re-acquire lock for full login
                            await this._acquireAccountLoginLock(accountId);
                        }
                    }

                    if (email && pwd) {
                        this.log('Auto-login initiated for ' + email);

                        // ----------------------------------------------------
                        // ADDED: Account Chooser Recovery (Signed Out Session)
                        // ----------------------------------------------------
                        this.log('Checking for Account Chooser / Signed Out state...');
                        await this.sleep(4000); // ★ Chờ Google Account Chooser render xong
                        try {
                            // Strategy: Use page.evaluate to find the exact email text element,
                            // then walk UP the DOM to find the clickable row container (li or ancestor div with click handler)
                            const accountChooserHandled = await this.safeEvaluate(targetPage, (targetEmail) => {
                                // 1. Find all elements and look for one whose OWN text (not children) contains the email
                                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
                                let textNode;
                                while (textNode = walker.nextNode()) {
                                    if (textNode.textContent && textNode.textContent.trim().toLowerCase().includes(targetEmail.trim().toLowerCase())) {
                                        // Found the text node — walk up to find the clickable row
                                        let clickTarget = textNode.parentElement;
                                        // Walk up to find li, or a reasonable clickable ancestor (max 6 levels)
                                        for (let i = 0; i < 6 && clickTarget; i++) {
                                            if (clickTarget.tagName === 'LI' || clickTarget.getAttribute('role') === 'link' || clickTarget.getAttribute('data-authuser') !== null) {
                                                break;
                                            }
                                            clickTarget = clickTarget.parentElement;
                                        }
                                        if (clickTarget) {
                                            const r = clickTarget.getBoundingClientRect();
                                            if (r.width > 0 && r.height > 0) {
                                                return { action: 'email', x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 4 - 2) };
                                            }
                                        }
                                    }
                                }

                                // 2. If email not found, look for "Use another account"
                                const allElements = document.querySelectorAll('div, span, button, li');
                                for (let el of allElements) {
                                    if (el.textContent) {
                                        const t = el.textContent.trim().toLowerCase();
                                        if (t === 'use another account' || t === 'sử dụng tài khoản khác' || t === 'sử dụng một tài khoản khác') {
                                            const r = el.getBoundingClientRect();
                                            if (r.width > 0 && r.height > 0) {
                                                return { action: 'other', x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 4 - 2) };
                                            }
                                        }
                                    }
                                }

                                return null;
                            }, email);

                            let clickedAccount = false;
                            if (accountChooserHandled) {
                                this.log(`[AccountChooser] Found target: action=${accountChooserHandled.action}, coords=(${Math.round(accountChooserHandled.x)}, ${Math.round(accountChooserHandled.y)})`);
                                
                                // Use direct click on coordinates — most reliable for Google's obfuscated DOM
                                await this.humanClick(targetPage, accountChooserHandled.x, accountChooserHandled.y, { reason: 'account_chooser_' + accountChooserHandled.action });
                                
                                if (accountChooserHandled.action === 'email') {
                                    this.log(`[AccountChooser] Clicked saved account: ${email}`);
                                } else {
                                    this.log('[AccountChooser] Clicked "Use another account"');
                                }
                                clickedAccount = true;

                                // Wait and verify we navigated away from chooser
                                await this.sleep(2000 + Math.random() * 500);
                            } else {
                                this.log('[AccountChooser] No account chooser detected — proceeding to normal login flow.');
                            }
                        } catch (e) {
                            this.log(`[AccountChooser] Error during account chooser handling: ${e.message}. Continuing to normal login flow.`);
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
                            const handle = await targetPage.waitForFunction(() => {
                                const email = document.querySelector('input[type="email"], input[name="identifier"]');
                                if (email && email.getBoundingClientRect().width > 0) return 'email';
                                const pwd = document.querySelector('input[type="password"], input[name="Passwd"]');
                                if (pwd && pwd.getBoundingClientRect().width > 0) return 'password';
                                const workspace = document.querySelector('[data-slate-editor="true"][role="textbox"]');
                                if (workspace && workspace.getBoundingClientRect().width > 0) return 'workspace';
                                if (document.body.textContent.includes('Welcome to Veo') || document.querySelector('a[href*="logout"]') || document.body.textContent.includes('Sign out')) {
                                    return 'workspace';
                                }
                                return null;
                            }, null, { timeout: 15000 });
                            authState = await handle.jsonValue();
                        } catch (raceErr) {
                            this.log(`[Login] Auth state detection timeout or failed: ${raceErr.message}. Defaulting to email flow.`);
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

                                // Find 2FA input prioritizing Google's totpPin selector and ensuring it is visible
                                const tfaSelector = 'input#totpPin, input[name="totpPin"], input[type="tel"], input[autocomplete="one-time-code"], input[name*="pin" i], input[id*="pin" i]';
                                try {
                                    await targetPage.waitForSelector(tfaSelector, { timeout: 15000, state: 'visible' });
                                    this.log('Found 2FA input, focusing and entering OTP...');

                                    await targetPage.focus(tfaSelector, { timeout: 5000 });
                                    await this.sleep(500);
                                    await targetPage.click(tfaSelector, { force: true, timeout: 3000 }).catch(() => { });
                                    await this.sleep(300);
                                    await targetPage.fill(tfaSelector, '', { timeout: 3000 }).catch(() => { });
                                    await targetPage.keyboard.insertText(token);

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

                                    this.log(`OTP ${token} submitted.`);
                                    await this.sleep(2000 + Math.random() * 1000);
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
                            if (isFlowUrl(url)) {
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
                        if (urlAfterLogin.includes('myaccount.google.com') || (!isFlowUrl(urlAfterLogin) && !isChallenge)) {
                            this.log(`Stuck on intermediate page (${urlAfterLogin.substring(0, 40)}...). Redirecting to Veo3...`);
                            await this.sleep(2000 + Math.random() * 1000);
                            await targetPage.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                            await this.sleep(1500 + Math.random() * 1000);
                        }

                        // Final wait for redirect back to labs
                        this.log('Waiting for Labs to load post-login...');

                        let postLoginLoaded = false;
                        for (let w = 0; w < 60; w++) {
                            try {
                                const isReady = await targetPage.evaluate(() => {
                                    if (document.querySelector('[data-slate-editor="true"][role="textbox"]')) return true;
                                    const hasUserAvatar = !!document.querySelector('img[src*="googleusercontent.com"]');
                                    if (hasUserAvatar) return true;
                                    const textNodes = Array.from(document.querySelectorAll('div, span, button'));
                                    return textNodes.some(el => el.textContent && (el.textContent.includes('Dự án mới') || el.textContent.includes('New Project') || el.textContent.trim() === 'Google Flow TV'));
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
                            // Authenticated signals only — NOT isFlowPage or "Create with Flow" (appear on public page)
                            const hasUserAvatar = !!document.querySelector('img[src*="googleusercontent.com"]');
                            const inProject = (['labs.google', 'flow.google.com'].includes(window.location.hostname) && /\/project\/[^/?#]+/.test(window.location.pathname));
                            const textNodes = Array.from(document.querySelectorAll('div, span, button'));
                            const hasNewProject = textNodes.some(el => el.textContent && /dự án mới|new project|create project|tạo dự án/i.test(el.textContent));
                            return hasEditor || hasUserAvatar || inProject || hasNewProject;
                        }, { timeout: 30000, polling: 1000 });

                        this.log('Auto-login successful! Proceeding...');

                        // Release 2FA lock after successful login
                        if (tfaSecret) {
                            this._releaseAccountLoginLock(accountId, true);
                        }

                        // Inform backend to update account to hasProfile = true if necessary
                        if (this.accountData && this.accountData.id && this.automationService && this.automationService.accountManager) {
                            this.automationService.accountManager.updateAccount(this.accountData.id, { hasProfile: true });
                        }
                    } else {
                        this.log('Credentials missing or invalid. Need manual login.');
                        needManualLogin = true;
                    }

                    if (needManualLogin) {
                        this.log(`[Login] Auto-login requested manual fallback. Waiting for manual login (3 mins)...`);
                        await this.waitForManualLogin();
                    }
                } catch (autoErr) {
                    // Release 2FA lock on any login failure
                    if (tfaSecret) {
                        this._releaseAccountLoginLock(accountId);
                    }
                    this.log('Auto-login failed or needed manual intervention: ' + autoErr.message);

                    // If manual login timed out, DON'T check for CAPTCHA — let it propagate
                    // to the outer catch (L1542) where the counter-based restart logic lives.
                    if (autoErr.message && autoErr.message.includes('Manual login timeout')) {
                        throw autoErr;
                    }

                    // Scan for actual Captcha element on DOM — but ONLY if NOT on Google login page
                    // (Google login pages contain "Robot" text in ToS/reCAPTCHA disclaimer, causing false positives)
                    let currentPageUrl = '';
                    try { currentPageUrl = targetPage.url(); } catch (_) {}

                    const isGoogleLoginPage = currentPageUrl.includes('accounts.google.com') || currentPageUrl.includes('signin');
                    const hasCaptchaOnPage = !isGoogleLoginPage && await targetPage.evaluate(() => {
                        const imgCaptcha = document.querySelector('#captchaimg');
                        const reCaptcha = document.querySelector('.g-recaptcha');
                        const isVisible = (el) => el && el.offsetParent !== null;
                        if (isVisible(imgCaptcha) || isVisible(reCaptcha)) return true;
                        // Only match specific CAPTCHA challenge phrases, not generic "Robot" in ToS
                        const bodyText = document.body.textContent || '';
                        return bodyText.includes('unusual traffic') ||
                            bodyText.includes('automated queries') ||
                            bodyText.includes('solve this captcha');
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
                                await targetPage.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
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
                            if (isFlowUrl(lastChanceUrl)) {
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

                    this.log(`[Login] Falling back to manual login wait (3 mins)... (Reason: ${autoErr.message})`);
                    await this.waitForManualLogin();
                } finally {
                    this.log('[Login] Luồng đăng nhập kết thúc.');
                }
            } else {
                // If already logged in, simulate human scrolling
                await this.humanScroll(targetPage);
            }

            await this._clickCreateFlowIfNeeded();
            await this.saveAuthCookiesToDisk();

        } catch (e) {
            this.log(`Error during login check: ${e.message}`);

            // Manual login timeout → restart browser to re-trigger auto-login (max 2 attempts)
            if (e.message && e.message.includes('Manual login timeout')) {
                this._loginRestartCount = (this._loginRestartCount || 0) + 1;
                if (this._loginRestartCount <= 2) {
                    this.log(`[Login] ⚠️ Manual login timed out. Restarting browser to re-trigger auto-login (attempt ${this._loginRestartCount}/2)...`);
                    try {
                        await this.performBrowserRestart('manual_login_timeout_auto_retry');
                        this._loginRestartCount = 0; // Login succeeded after restart → reset counter
                        return;
                    } catch (restartErr) {
                        this.log(`[Login] ❌ Restart attempt ${this._loginRestartCount} failed: ${restartErr.message}`);
                        this._loginRestartCount = 0; // Reset counter to allow future attempts
                        this.isOffline = true;
                        await this.close(true).catch(() => { });
                        throw e;
                    }
                }
                this.log(`[Login] ❌ Max login restart attempts (2) reached. Giving up.`);
                this._loginRestartCount = 0; // Reset counter to allow future attempts
            }

            this.isOffline = true;
            await this.close(true).catch(() => { });
            throw e; // Rethrow to fail launch!
        } finally {
            if (this._holdsLoginLock) {
                this._releaseAccountLoginLock(accountId);
            }
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
            // Only applies when on Flow Flow pages
            if (!isFlowUrl(url)) return;

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
                    await this.page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
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
                    // Only accept AUTHENTICATED signals — NOT "Create with Google Flow" text
                    // or isFlowPage URL (both appear on the PUBLIC landing page too!)
                    const hasEditor = !!document.querySelector('[data-slate-editor="true"][role="textbox"]');
                    const isMyAccount = window.location.href.includes('myaccount.google.com');
                    // User avatar = definitive authenticated signal
                    const hasUserAvatar = !!document.querySelector('img[src*="googleusercontent.com"]');
                    // Project URL = already inside a project
                    const inProject = (['labs.google', 'flow.google.com'].includes(window.location.hostname) && /\/project\/[^/?#]+/.test(window.location.pathname));
                    // Gallery text = authenticated workspace
                    const textNodes = Array.from(document.querySelectorAll('div, span, button'));
                    const hasNewProject = textNodes.some(el => {
                        if (!el.textContent) return false;
                        const t = el.textContent.trim().toLowerCase();
                        return t.includes('dự án mới') || t.includes('new project');
                    });
                    const hasFlowTV = textNodes.some(el => el.textContent && el.textContent.trim() === 'Google Flow TV');
                    return hasEditor || isMyAccount || hasUserAvatar || inProject || hasNewProject || hasFlowTV;
                },
                { timeout: 180000, polling: 1000 }
            );

            // Double check if we need to redirect
            const currentUrl = await this.page.url();
            if (currentUrl.includes('myaccount.google.com') || (currentUrl.includes('labs.google') && !isFlowUrl(currentUrl))) {
                this.log('Detected successful login. Redirecting to Veo3 Flow page...');
                await this.page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await this.sleep(1500 + Math.random() * 1000);
            }

            this.log('Login successful! Proceeding...');
            this._loginRestartCount = 0; // Reset restart counter on successful login

            // If logged in successfully, update hasProfile flag
            if (this.accountData && this.accountData.id && this.automationService && this.automationService.accountManager) {
                this.automationService.accountManager.updateAccount(this.accountData.id, { hasProfile: true });
            }
        } catch (timeoutErr) {
            this.log('[Login] ⚠️ Manual login timed out after 3 minutes. Will attempt browser restart.');
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
        if (options.clickCount) clickOptions.clickCount = options.clickCount;
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
            await this.sleep(1000 + Math.random() * 400);

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
                this.log(`⚠️  Model dropdown not detected (menus: ${menuCountBefore} -> ${menuCountAfter}). Retrying (${attempt + 1}/${MAX_RETRIES})...`);
                await this.humanClick(page, 150 + Math.random() * 100, 400 + Math.random() * 100);
                await this.sleep(500);
            } else {
                this.log(`⚠️ Model dropdown failed to open after ${MAX_RETRIES + 1} attempts. Proceeding anyway...`);
            }
        }

        // Đợi dropdown menu items render ổn định trước khi click
        await this.sleep(300 + Math.random() * 200);

        // Select the model item với retry + verify
        for (let selectAttempt = 0; selectAttempt <= 2; selectAttempt++) {
            const clicked = await clickCoord(coords.model, modelName);
            if (!clicked) {
                this.log(`[Model] ⚠️ Model item "${modelName}" not found (attempt ${selectAttempt + 1}/3)`);
                if (selectAttempt < 2) {
                    await this.sleep(500 + Math.random() * 300);
                    continue;
                }

                // === DEBUG: Dump all visible dropdown items ===
                const dropdownItems = await page.evaluate(() => {
                    const items = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"]');
                    const visible = [];
                    for (const item of items) {
                        const r = item.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            visible.push((item.textContent || '').trim().substring(0, 80));
                        }
                    }
                    return visible;
                }).catch(() => []);
                this.log(`[Model] 📋 Available dropdown items (${dropdownItems.length}): ${JSON.stringify(dropdownItems)}`);

                // === FUZZY FALLBACK: Strip emojis/special chars, match substring ===
                const cleanTarget = modelName.replace(/[^\w\s.-]/g, '').trim().toLowerCase();
                if (cleanTarget) {
                    const fuzzyResult = await page.evaluate((target) => {
                        const items = document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"]');
                        for (const item of items) {
                            const r = item.getBoundingClientRect();
                            if (r.width <= 0 || r.height <= 0) continue;
                            const text = (item.textContent || '').replace(/[^\w\s.-]/g, '').trim().toLowerCase();
                            if (text.includes(target) || target.includes(text)) {
                                return { x: r.x + r.width / 2, y: r.y + r.height / 2, matchedText: (item.textContent || '').trim() };
                            }
                        }
                        return null;
                    }, cleanTarget).catch(() => null);

                    if (fuzzyResult) {
                        this.log(`[Model] 🔄 Fuzzy match found: "${fuzzyResult.matchedText}" for target "${modelName}". Clicking...`);
                        await this.humanClick(page, fuzzyResult.x, fuzzyResult.y);
                        await this.sleep(400 + Math.random() * 200);
                        break;
                    }
                }

                this.log(`[Model] ⚠️ Model "${modelName}" could not be selected after 3 attempts + fuzzy. Proceeding anyway.`);
                break;
            }
            await this.sleep(400 + Math.random() * 200);

            // Verify: dropdown đã đóng (nghĩa là item được chọn thành công)
            const menuStillOpen = await page.evaluate(() => {
                const menus = document.querySelectorAll('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]');
                for (const m of menus) {
                    const r = m.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return true;
                }
                return false;
            }).catch(() => false);

            if (!menuStillOpen) {
                this.log(`[Model] ✓ Model "${modelName}" selected successfully (menu closed).`);
                break;
            }

            if (selectAttempt < 2) {
                this.log(`[Model] ⚠️ Menu still open after selecting "${modelName}". Retrying (${selectAttempt + 1}/2)...`);
                await this.sleep(300);
            } else {
                this.log(`[Model] ⚠️ Menu still open after 3 attempts. Closing via Escape...`);
                await page.keyboard.press('Escape');
                await this.sleep(300);
            }
        }
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
            // Diagnostic: capture DOM state tại thời điểm fail
            try {
                const diagState = await page.evaluate(() => {
                    const dialog = document.querySelector('[role="dialog"]');
                    const scroller = dialog?.querySelector('[data-testid="virtuoso-scroller"]');
                    const list = scroller?.querySelector('[data-testid="virtuoso-item-list"]');
                    return {
                        hasDialog: !!dialog,
                        hasScroller: !!scroller,
                        hasList: !!list,
                        scrollerVisible: scroller ? (scroller.offsetParent !== null && scroller.getBoundingClientRect().width > 0) : false,
                        url: window.location.href.substring(0, 80),
                        dialogCount: document.querySelectorAll('[role="dialog"]').length
                    };
                }).catch(() => ({ error: 'diag_failed' }));
                this.log(`[Gallery] 🔍 Diagnostic at fail: ${JSON.stringify(diagState)}`);
            } catch (_) {}
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
        const truncated25 = filePrefix.substring(0, 25);
        const searchQuery = filePrefix;

        const isVideo = /\.(mp4|webm|mov|avi|mkv)$/i.test(filePath);
        this.log(`[Gallery] Checking gallery for "${filePrefix}" (isVideo: ${isVideo})...`);

        // Giả lập thời gian quét mắt xác định hộp thoại và tìm kiếm sơ bộ (500ms - 800ms)
        await this.sleep(500 + Math.floor(Math.random() * 300));

        // Đợi cấu trúc Virtuoso Gallery tải xong và ổn định
        const galleryStatus = await this.ensureVirtuosoGalleryLoaded(page, 10000);
        if (galleryStatus === 'EMPTY_STATE') {
            this.log('[Gallery] Empty state detected during loading wait. Skipping gallery check.');
            return { success: false, reason: 'EMPTY_STATE' };
        }

        const scanResult = await page.evaluate(({ fileName, filePrefix, truncated15, truncated20, truncated25, isVideo }) => {
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
                const itemText = nameEl ? (nameEl.textContent || '').trim().toLowerCase() : '';
                const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';

                const isOptionVideo = itemType.includes('video');
                if (isVideo && !isOptionVideo) continue;
                if (!isVideo && isOptionVideo) continue;

                const txt = itemText || (opt.textContent || '').trim().toLowerCase();
                const imgEl = opt.querySelector('img');

                let textMatched = false;
                let imgMatched = false;

                textMatched = txt.length >= 4 && (
                    txt.includes(fileName.toLowerCase()) ||
                    txt.includes(filePrefix.toLowerCase()) ||
                    txt.includes(truncated15.toLowerCase()) ||
                    txt.includes(truncated20.toLowerCase()) ||
                    txt.includes(truncated25.toLowerCase())
                );

                if (imgEl) {
                    const alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                    const src = (imgEl.getAttribute('src') || '').toLowerCase();
                    imgMatched = alt.includes(fileName.toLowerCase()) || src.includes(fileName.toLowerCase()) ||
                        alt.includes(filePrefix.toLowerCase()) || src.includes(filePrefix.toLowerCase()) ||
                        alt.includes(truncated15.toLowerCase()) || src.includes(truncated15.toLowerCase()) ||
                        alt.includes(truncated20.toLowerCase()) || src.includes(truncated20.toLowerCase()) ||
                        alt.includes(truncated25.toLowerCase()) || src.includes(truncated25.toLowerCase());
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
                const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';
                if (isVideo) {
                    if (!itemType.includes('video')) {
                        return { success: false, reason: 'EXPECTED_VIDEO_BUT_GOT_IMAGE', itemType };
                    }
                } else {
                    // Relaxed filter: chỉ reject khi CHẮC CHẮN là video
                    // DOM text thay đổi theo ngôn ngữ/render timing → không check strict 'hình ảnh'
                    if (itemType.includes('video')) {
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
                const text = (matchedOption.textContent || '').trim();

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
        }, { fileName, filePrefix, truncated15, truncated20, truncated25, isVideo });

        if (scanResult.error === 'GALLERY_SCOPE_NOT_FOUND') {
            this.log(`[Gallery] 🛑 Fail-Fast: GALLERY_SCOPE_NOT_FOUND (reason: ${scanResult.reason})`);
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: GALLERY_SCOPE_NOT_FOUND');
        }
        if (scanResult.error === 'UNSAFE_GALLERY_CLICK_REJECTED') {
            this.log(`[Gallery] 🛑 Fail-Fast: UNSAFE_GALLERY_CLICK_REJECTED (reason: ${scanResult.reason})`);
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: UNSAFE_GALLERY_CLICK_REJECTED');
        }

        this.log(`[Gallery] Found ${scanResult.itemCount || 0} items in gallery. Using search box to find exact match...`);

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
                    await page.keyboard.down('Control');
                    await page.keyboard.press('a');
                    await page.keyboard.up('Control');
                    await page.keyboard.press('Backspace');
                    await this.sleep(800);
                }
            } catch (err) {
                this.log(`[Gallery] Warning: Failed to clear search input: ${err.message}`);
            }
        };

        await searchInput.click({ humanConfig: { idle_between_actions: false } });
        await this.sleep(300);
        // Instant paste (same technique as password input) — no character-by-character typing
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.insertText(searchQuery);
        await this.sleep(500 + Math.floor(Math.random() * 200));

        // Đợi cấu trúc Virtuoso Gallery tải xong và ổn định sau khi tìm kiếm
        const postSearchStatus = await this.ensureVirtuosoGalleryLoaded(page, 5000).catch(() => null);
        if (postSearchStatus === 'EMPTY_STATE' || !postSearchStatus) {
            this.log('[Gallery] Empty state or loading failed after search. Clearing input and uploading fresh.');
            await clearSearchInput();
            return { success: false, reason: 'EMPTY_STATE_POST_SEARCH' };
        }

        const scanResultAfterSearch = await page.evaluate(({ fileName, filePrefix, truncated15, truncated20, truncated25, isVideo }) => {
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
                const itemText = nameEl ? (nameEl.textContent || '').trim().toLowerCase() : '';
                const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';

                const isOptionVideo = itemType.includes('video');
                if (isVideo && !isOptionVideo) continue;
                if (!isVideo && isOptionVideo) continue;

                const txt = itemText || (opt.textContent || '').trim().toLowerCase();
                const imgEl = opt.querySelector('img');

                let textMatched = false;
                let imgMatched = false;

                textMatched = txt.length >= 4 && (
                    txt.includes(fileName.toLowerCase()) ||
                    txt.includes(filePrefix.toLowerCase()) ||
                    txt.includes(truncated15.toLowerCase()) ||
                    txt.includes(truncated20.toLowerCase()) ||
                    txt.includes(truncated25.toLowerCase())
                );

                if (imgEl) {
                    const alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                    const src = (imgEl.getAttribute('src') || '').toLowerCase();
                    imgMatched = alt.includes(fileName.toLowerCase()) || src.includes(fileName.toLowerCase()) ||
                        alt.includes(filePrefix.toLowerCase()) || src.includes(filePrefix.toLowerCase()) ||
                        alt.includes(truncated15.toLowerCase()) || src.includes(truncated15.toLowerCase()) ||
                        alt.includes(truncated20.toLowerCase()) || src.includes(truncated20.toLowerCase()) ||
                        alt.includes(truncated25.toLowerCase()) || src.includes(truncated25.toLowerCase());
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
                const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';
                if (isVideo) {
                    if (!itemType.includes('video')) {
                        return { success: false, reason: 'EXPECTED_VIDEO_BUT_GOT_IMAGE', itemType };
                    }
                } else {
                    // Relaxed filter: chỉ reject khi CHẮC CHẮN là video
                    if (itemType.includes('video')) {
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
                const text = (matchedOption.textContent || '').trim();

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
        }, { fileName, filePrefix, truncated15, truncated20, truncated25, isVideo }).catch(err => ({ error: 'EVALUATE_FAILED', reason: err.message }));

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

        // Giả lập thời gian nhận thức & định vị (500ms - 700ms) để giống người thật
        await this.sleep(500 + Math.floor(Math.random() * 200));
        this.log(`[Gallery] Match found after search. Clicking to select: ${scanResultAfterSearch.coords.x}, ${scanResultAfterSearch.coords.y}`);
        await this.humanClick(page, scanResultAfterSearch.coords.x, scanResultAfterSearch.coords.y);
        this.log('[Gallery] [gallery_item_selected] Đã click chọn thành công item lọc được sau khi search trong gallery.');
        await this.sleep(500 + Math.random() * 300);

        await this.checkAndRecoverEditView(page);
        this.log('[Gallery] [gallery_item_selected] Selected existing image from gallery.');
        return { success: true, coords: scanResultAfterSearch.coords, scopeValidated: true, imgRect: scanResultAfterSearch.imgRect };
    }

    async waitForGalleryItemAndSelect(page, singleFile, timeoutMs = 25000, beforeState = { count: 0, items: [] }) {
        const fileName = path.basename(singleFile);
        const filePrefix = fileName.replace(/\.[^.]+$/, '');
        const truncated15 = filePrefix.substring(0, 15);
        const truncated20 = filePrefix.substring(0, 20);
        const truncated25 = filePrefix.substring(0, 25);
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
            const scanResult = await page.evaluate(({ fileName, filePrefix, truncated15, truncated20, truncated25, isVideo, beforeState }) => {
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
                    const itemText = nameEl ? (nameEl.textContent || '').trim().toLowerCase() : '';
                    const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';

                    const isOptionVideo = itemType.includes('video');
                    if (isVideo && !isOptionVideo) continue;
                    if (!isVideo && isOptionVideo) continue;

                    const txt = itemText || (opt.textContent || '').trim().toLowerCase();
                    const imgEl = opt.querySelector('img');

                    let textMatched = false;
                    let imgMatched = false;

                    textMatched = txt.length >= 4 && (
                    txt.includes(fileName.toLowerCase()) ||
                    txt.includes(filePrefix.toLowerCase()) ||
                    txt.includes(truncated15.toLowerCase()) ||
                    txt.includes(truncated20.toLowerCase()) ||
                    txt.includes(truncated25.toLowerCase())
                );

                    if (imgEl) {
                        const alt = (imgEl.getAttribute('alt') || '').toLowerCase();
                        const src = (imgEl.getAttribute('src') || '').toLowerCase();
                        imgMatched = alt.includes(fileName.toLowerCase()) || src.includes(fileName.toLowerCase()) ||
                        alt.includes(filePrefix.toLowerCase()) || src.includes(filePrefix.toLowerCase()) ||
                        alt.includes(truncated15.toLowerCase()) || src.includes(truncated15.toLowerCase()) ||
                        alt.includes(truncated20.toLowerCase()) || src.includes(truncated20.toLowerCase()) ||
                        alt.includes(truncated25.toLowerCase()) || src.includes(truncated25.toLowerCase());

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
                        const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';
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
                            const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';
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
                    const itemType = typeEl ? (typeEl.textContent || '').trim().toLowerCase() : '';
                    if (isVideo) {
                        if (!itemType.includes('video')) {
                            return { success: false, reason: 'EXPECTED_VIDEO_BUT_GOT_IMAGE', itemType };
                        }
                    } else {
                        // Relaxed filter: chỉ reject khi CHẮC CHẮN là video
                        if (itemType.includes('video')) {
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
                    const text = (matchedOption.textContent || '').trim();

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
            }, { fileName, filePrefix, truncated15, truncated20, truncated25, isVideo, beforeState });

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

            await this.sleep(1000 + Math.random() * 500);
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
                        const txt = (el.textContent || '').trim().toLowerCase();
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
                    const txt = (btn.textContent || '').toLowerCase();
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
                const progressTexts = texts.map(el => (el.textContent || '').trim()).filter(t => {
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
        if (selectionDetails?.angularDetail) {
            const { addAngularMediaToPrompt } = require('./flowUpload');
            await addAngularMediaToPrompt(page, 35000, msg => this.log(msg));
            this.log('[AttachFlow] Angular Add to prompt: new media verified in prompt.');
            return true;
        }

        const checkRecoverAndVerify = async (timeoutMs) => {
            // Tự động kiểm tra kẹt ở /edit/ và bấm Back để phục hồi
            await this.checkAndRecoverEditView(page);
            return await this.waitForUploadConfirmation(page, beforeCount, 1, timeoutMs, fileName);
        };

        // --- LỚP 1 [TỐI ƯU]: Kiểm tra nhanh auto-attach (1.5s thay vì 8s) ---
        this.log('[AttachFlow] Lớp 1: Kiểm tra nhanh auto-attach (1.5s)...');
        try {
            const attached = await checkRecoverAndVerify(1500);
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
                        firstItemCoords = { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (firstOption.textContent || '').substring(0, 30) };
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
                await this.humanClick(page, galleryState.firstItemCoords.x, galleryState.firstItemCoords.y, { clickCount: 2 });
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

                    const txt = (btn.textContent || '').trim().toLowerCase();
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

                    const txt = (btn.textContent || '').trim().toLowerCase();
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

                    const txt = (btn.textContent || '').trim().toLowerCase();
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
                // Độ trễ ngẫu nhiên 500ms - 1000ms trước khi click confirm
                const delayMs = 500 + Math.floor(Math.random() * 500);
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
                        text: (btn.textContent || '').trim().substring(0, 50),
                        ariaLabel: btn.getAttribute('aria-label') || 'none',
                        role: btn.getAttribute('role') || 'none',
                        disabled: btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true',
                        rect: btn.getBoundingClientRect().toJSON()
                    };
                }) : [];

                const selectedOption = dialog ? Array.from(dialog.querySelectorAll('[role="option"]')).map(opt => {
                    const img = opt.querySelector('img');
                    return {
                        text: (opt.textContent || '').trim().substring(0, 50),
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
                    txt: (opt.textContent || '').substring(0, 30)
                }))
            };
        }).catch(() => ({ count: 0, items: [] }));

        // Direct upload: check if input[type="file"] exists in the dialog and upload directly (Prevents OS Open dialog popups)
        const fileInput = page.locator('[role="dialog"] input[type="file"], div[class*="dialog"] input[type="file"], input[type="file"]').first();
        let uploadSuccess = false;

        if (await fileInput.count().catch(() => 0) > 0) {
            this.log(`[UploadCore] Direct file input upload bypassing file chooser click: ${fileName}`);
            try {
                // Giả lập thời gian người dùng duyệt và chọn file trên máy
                const browseDelay = 2000 + Math.floor(Math.random() * 2000);
                this.log(`[UploadCore] Giả lập duyệt chọn file trong ${(browseDelay / 1000).toFixed(1)}s...`);
                await this.sleep(browseDelay);
                await fileInput.setInputFiles([singleFile]);
                await this.sleep(1500 + Math.random() * 1000);
                uploadSuccess = true;
            } catch (err) {
                this.log(`[UploadCore] Direct file upload failed: ${err.message}. Falling back to click-chooser...`);
            }
        }

        if (!uploadSuccess) {
            this.log('[UploadCore] Bypassing direct upload or failed. Using fallback click-chooser method...');
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
                                const t = (el.textContent || '').trim().toLowerCase();
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
        }

        const selectionResult = await this.waitForGalleryItemAndSelect(page, singleFile, 25000, dialogItemCountBefore);
        if (!selectionResult.success) {
            throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Uploaded item did not appear in gallery or selection failed');
        }

        return { success: true, source: 'fresh_upload', details: selectionResult.details || selectionResult };
    }

    /**
     * Batch Upload: Tải lên TẤT CẢ các file trong allPendingFiles cùng một lúc,
     * sau đó chờ và click chọn targetFile (file đang cần chèn) trong gallery.
     * Chỉ gọi 1 lần duy nhất cho toàn bộ danh sách ảnh mới.
     */
    async batchUploadAndSelectFirst(page, targetFile, allPendingFiles, angularUpload = false) {
        const fileName = path.basename(targetFile);
        const angularFlow = angularUpload || await page.locator('mat-icon.add-menu-icon').count() > 0;
        if (angularFlow) allPendingFiles = [targetFile];
        this.log(`[BatchUpload] Tai len hang loat ${allPendingFiles.length} file. Chon: ${fileName}`);

        // Ghi nhận số item trước khi upload để so sánh sau
        const dialogItemCountBefore = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return { count: 0, items: [] };
            const listContainer = dialog.querySelector('[data-testid="virtuoso-item-list"]') || dialog;
            const options = Array.from(listContainer.querySelectorAll('[role="option"]'));
            return {
                count: options.length,
                items: options.map(opt => ({
                    idx: opt.getAttribute('data-index') || opt.parentElement?.getAttribute('data-index') || '',
                    src: opt.querySelector('img')?.src || '',
                    txt: (opt.textContent || '').substring(0, 30)
                }))
            };
        }).catch(() => ({ count: 0, items: [] }));

        // Phương pháp 1: Direct file input (ưu tiên, không mở OS dialog)
        const fileInput = page.locator('[role="dialog"] input[type="file"], div[class*="dialog"] input[type="file"], input[type="file"]').first();
        let uploadSuccess = false;

        if (await fileInput.count().catch(() => 0) > 0) {
            this.log(`[BatchUpload] Direct input: truyen ${allPendingFiles.length} file cung luc...`);
            try {
                // Giả lập thời gian người dùng duyệt và chọn nhiều file trên máy
                const browseDelay = 2500 + Math.floor(Math.random() * 2000);
                this.log(`[BatchUpload] Giả lập duyệt chọn ${allPendingFiles.length} file trong ${(browseDelay / 1000).toFixed(1)}s...`);
                await this.sleep(browseDelay);
                await fileInput.setInputFiles(allPendingFiles);
                await this.sleep(1000 + Math.random() * 500);
                uploadSuccess = true;
            } catch (err) {
                this.log(`[BatchUpload] Direct input that bai: ${err.message}. Fallback file chooser...`);
            }
        }

        // Phương pháp 2: File chooser fallback
        if (!uploadSuccess) {
            this.log('[BatchUpload] Bypassing direct upload. Using fallback click-chooser method...');
            const { clickUploadMedia, waitForUploadChooser } = require('./flowUpload');
            const fileChooser = await waitForUploadChooser(page, async () => {
                this.log('[BatchUpload] Waiting for visible Upload media control...');
                await clickUploadMedia(page, 35000);
                this.log('[BatchUpload] Upload click completed; checking file chooser event...');
            });

            // Giả lập OS dialog
            await page.evaluate(() => {
                window.dispatchEvent(new Event('blur'));
                if (Object.defineProperty) {
                    try { Object.defineProperty(document, 'hasFocus', { get: () => false, configurable: true }); } catch (e) { }
                }
            }).catch(() => { });

            const chooseDelay = 2500 + Math.floor(Math.random() * 2000);
            this.log(`[BatchUpload] File Chooser opened. Giả lập duyệt chọn ${allPendingFiles.length} files trên OS trong ${(chooseDelay / 1000).toFixed(1)}s...`);
            await this.sleep(chooseDelay);

            this.log(`[BatchUpload] Setting ${allPendingFiles.length} files...`);
            await fileChooser.setFiles(allPendingFiles);

            // Giả lập Window nhận lại tập trung
            await page.evaluate(() => {
                window.dispatchEvent(new Event('focus'));
                if (Object.defineProperty) {
                    try { Object.defineProperty(document, 'hasFocus', { get: () => true, configurable: true }); } catch (e) { }
                }
            }).catch(() => { });
        }

        if (angularFlow) {
            // Wait for upload to fully complete — ensure no loading spinners are active
            // This prevents clicking "Add to prompt" on an old gallery item while the new upload is still loading
            await page.locator('button.detail-add-to-prompt-btn:visible').waitFor({ state: 'visible', timeout: 35000 });

            // Wait for any loading indicators to disappear (the spinning circle on the uploading image)
            try {
                await page.waitForFunction(() => {
                    // Check for Angular Material spinner (mat-spinner / mat-progress-spinner)
                    const spinners = document.querySelectorAll('mat-spinner, mat-progress-spinner, .mat-mdc-progress-spinner, [role="progressbar"]');
                    const visibleSpinners = Array.from(spinners).filter(s => {
                        const r = s.getBoundingClientRect();
                        return r.width > 0 && r.height > 0 && getComputedStyle(s).visibility !== 'hidden';
                    });
                    // Also check for loading class on media items
                    const loadingItems = document.querySelectorAll('.loading, [class*="loading"], [class*="uploading"]');
                    const visibleLoading = Array.from(loadingItems).filter(el => {
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    });
                    return visibleSpinners.length === 0 && visibleLoading.length === 0;
                }, null, { timeout: 30000 });
                this.log('[BatchUpload] Upload hoàn tất, không còn loading spinner.');
            } catch (e) {
                this.log(`[BatchUpload] ⚠️ Loading spinner vẫn còn sau 30s. Tiếp tục...`);
            }

            // ── Click chọn đúng ảnh mới upload trước khi "Add to prompt" ──
            // Khi gallery có nhiều ảnh cùng tên (cũ + mới), ảnh cũ có thể tự động được chọn (asset-item-active).
            // Cần click vào ảnh ĐẦU TIÊN khớp tên file (ảnh mới nhất theo sort "Recent") để chọn đúng.
            try {
                const targetFileName = fileName; // filename từ batchUploadAndSelectFirst param
                const clickResult = await page.evaluate((targetName) => {
                    const items = Array.from(document.querySelectorAll('button[role="option"].asset-item'));
                    // Find ALL items matching the filename
                    const matchingItems = items.filter(item => {
                        const titleSpan = item.querySelector('.asset-title');
                        if (!titleSpan) return false;
                        return titleSpan.textContent.trim() === targetName;
                    });

                    if (matchingItems.length === 0) return { found: false, reason: 'no_match' };

                    // The FIRST matching item is the most recently uploaded (sorted by "Recent")
                    const target = matchingItems[0];
                    const isAlreadyActive = target.classList.contains('asset-item-active');

                    const r = target.getBoundingClientRect();
                    if (r.width <= 0 || r.height <= 0) return { found: false, reason: 'not_visible' };

                    return {
                        found: true,
                        x: r.x + r.width / 2,
                        y: r.y + r.height / 2,
                        isAlreadyActive,
                        totalMatches: matchingItems.length,
                        fileName: targetName
                    };
                }, targetFileName);

                if (clickResult.found) {
                    if (clickResult.totalMatches > 1) {
                        this.log(`[BatchUpload] ⚠️ Phát hiện ${clickResult.totalMatches} ảnh trùng tên "${clickResult.fileName}" trong gallery. Click vào ảnh mới nhất (đầu tiên)...`);
                    }
                    if (!clickResult.isAlreadyActive || clickResult.totalMatches > 1) {
                        await this.humanClick(page, clickResult.x, clickResult.y, { reason: 'select_newest_upload' });
                        await this.sleep(800 + Math.random() * 400);
                        this.log(`[BatchUpload] ✓ Đã click chọn ảnh "${clickResult.fileName}" (mới nhất).`);
                    } else {
                        this.log(`[BatchUpload] ✓ Ảnh "${clickResult.fileName}" đã được chọn sẵn (chỉ có 1 bản).`);
                    }
                } else {
                    this.log(`[BatchUpload] ⚠️ Không tìm thấy ảnh "${targetFileName}" trong gallery. Tiếp tục với ảnh đang chọn...`);
                }
            } catch (e) {
                this.log(`[BatchUpload] ⚠️ Lỗi khi chọn ảnh: ${e.message}. Tiếp tục...`);
            }

            return { success: true, source: 'angular_upload_detail', details: { angularDetail: true } };
        }

        // Chờ targetFile xuất hiện trong gallery và click chọn nó (timeout 35s cho batch)
        const selectionResult = await this.waitForGalleryItemAndSelect(
            page, targetFile, 35000, dialogItemCountBefore
        );

        if (!selectionResult.success) {
            throw new Error(`IMAGE_UPLOAD_VERIFY_FAILED: Batch uploaded but ${fileName} not found in gallery`);
        }

        this.log(`[BatchUpload] Thanh cong! ${fileName} da duoc chon tu gallery sau batch upload.`);
        return { success: true, source: 'batch_upload', details: selectionResult.details || selectionResult };
    }

    /**
     * Gallery-Only Select: Dành cho ảnh đã được upload trong session này.
     * Chỉ tìm kiếm nhanh trong gallery và chọn, không upload lại.
     * Fallback sang selectOrUploadSingleMediaFromOpenDialog nếu không tìm thấy.
     */
    async selectFromGalleryOnly(page, filePath) {
        const fileName = path.basename(filePath);
        this.log(`[GallerySelect] Anh ${fileName} da co trong cache. Tim kiem nhanh trong gallery...`);

        const galleryRes = await this.tryClickGalleryImage(page, filePath);
        if (galleryRes && galleryRes.success) {
            this.log(`[GallerySelect] Tim thay ${fileName} trong gallery! Chon thanh cong.`);
            return { success: true, source: 'gallery_cached', details: galleryRes };
        }

        // Fallback: Nếu không tìm thấy trong gallery (edge case: gallery bị reset), upload đơn lẻ
        this.log(`[GallerySelect] Khong tim thay ${fileName} trong gallery du da upload. Fallback upload don le...`);
        return await this.selectOrUploadSingleMediaFromOpenDialog(page, filePath);
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

        // Phân loại: ảnh nào cần upload mới (chưa có trong gallery session cache), ảnh nào đã có
        // In Veo3, each project/job starts empty. Even if an image was uploaded to the account earlier in this session,
        // we must still open the dialog and select/attach it from the gallery into the current project's editor.
        const pendingUpload = [];
        const angularUpload = await page.locator('mat-icon.add-menu-icon').count() > 0;
        for (const p of pathsToUpload) {
            const resolved = path.resolve(p).toLowerCase();
            if (angularUpload || !this._uploadedImages.has(resolved)) {
                pendingUpload.push(p);
            }
        }
        this.log(`[Upload] Phan loai: ${pendingUpload.length} anh can upload moi, ${pathsToUpload.length - pendingUpload.length} anh da co trong gallery cache.`);

        this.log(`[Upload] Bat dau xu ly tai len ${pathsToUpload.length} anh (batch-upload + gallery-select)...`);
        let totalUploaded = 0;

        // Helper: Find the (+) attach button coordinates
        const findPlusBtnCoords = async () => {
            const { findAngularUploadButton } = require('./flowUpload');
            const angularButton = await findAngularUploadButton(page);
            if (angularButton) return angularButton;
            return page.evaluate(() => {
                const getCenter = (el) => {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 10 - 5) };
                    return null;
                };
                // Helper: find main Slate editor, skipping chat panel's clone
                const getMainSlateEditor = () => {
                    const editors = Array.from(document.querySelectorAll('div[data-slate-editor="true"][role="textbox"]'));
                    return editors.find(ed => {
                        const panel = ed.closest('div.sc-4e96504a-0, div.sc-1fffc27c-4');
                        if (panel && panel.querySelector('div[aria-label="Đổi kích thước bảng điều khiển tác nhân"], div[aria-label="Resize agent panel"]')) return false;
                        return true;
                    }) || editors[editors.length - 1];
                };
                const editor = getMainSlateEditor() || document.querySelector('.ql-editor, textarea, [contenteditable="true"]');
                if (editor) {
                    const container = editor.closest('form, div[role="search"], [class*="input"], [class*="bottom"], div[style*="border-radius"]') || editor.parentElement.parentElement.parentElement;
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

        for (const singleFile of pathsToUpload) {
            const resolvedPath = path.resolve(singleFile).toLowerCase();
            const fileName = path.basename(singleFile);
            const accountId = this.accountData.id || this.id;

            this.log(`[Upload] Xu ly: ${fileName}...`);
            try {
                // Fetch thumbCountBefore inside lock, right before manipulation (card-aware count)
                const thumbCountBefore = await page.evaluate(() => {
                    const cards = Array.from(document.querySelectorAll('button[data-card-open][data-state]')).filter(card => {
                        const img = card.querySelector('img[src*="media.getMediaUrlRedirect"]');
                        if (!img) return false;
                        const hasCancelIcon = Array.from(card.querySelectorAll('i, span, div, button')).some(el => {
                            const txt = (el.textContent || '').trim().toLowerCase();
                            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
                            const cls = (el.className || '').toLowerCase();
                            return txt === 'cancel' || txt === 'close' || txt === 'delete' || txt === 'remove' ||
                                aria.includes('cancel') || aria.includes('close') || aria.includes('delete') || aria.includes('remove') ||
                                cls.includes('cancel') || cls.includes('close') || cls.includes('delete') || cls.includes('remove');
                        });
                        return hasCancelIcon;
                    });
                    if (cards.length > 0) return cards.length;

                    // Find main editor (skip chat panel clone)
                    const _editors = Array.from(document.querySelectorAll('[data-slate-editor="true"][role="textbox"]'));
                    const _mainEd = _editors.find(ed => {
                        const p = ed.closest('div.sc-4e96504a-0, div.sc-1fffc27c-4');
                        return !(p && p.querySelector('div[aria-label="Đổi kích thước bảng điều khiển tác nhân"], div[aria-label="Resize agent panel"]'));
                    }) || _editors[_editors.length - 1];
                    const ec = _mainEd?.closest('div[style*="border-radius"]') || _mainEd?.parentElement?.parentElement || document.body;
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
                    await this.sleep(800 + Math.random() * 400);

                    // Verify dialog đã mở — retry nếu click bị nuốt (do upload quá nhanh)
                    // Angular opens a media picker rather than the legacy role=dialog.
                    if (angularUpload) {
                        await require('./flowUpload').selectAngularImagesTab(page, 35000, message => this.log(message));
                        return;
                    }
                    let dialogOpen = await page.locator('[role="dialog"]').isVisible({ timeout: 2000 }).catch(() => false);
                    if (!dialogOpen) {
                        this.log('[Upload] ⚠️ Dialog chưa mở sau click (+). Chờ UI ổn định rồi retry...');
                        await this.sleep(1500 + Math.random() * 500);
                        plusCoords = await findPlusBtnCoords();
                        if (plusCoords) {
                            await this.humanClick(page, plusCoords.x, plusCoords.y, { humanConfig: { idle_between_actions: false } });
                            await this.sleep(1200 + Math.random() * 500);
                            dialogOpen = await page.locator('[role="dialog"]').isVisible({ timeout: 3000 }).catch(() => false);
                        }
                        if (!dialogOpen) {
                            this.log('[Upload] ⚠️ Dialog vẫn không mở sau retry. Escape + click lại lần cuối...');
                            await page.keyboard.press('Escape');
                            await this.sleep(800);
                            plusCoords = await findPlusBtnCoords();
                            if (plusCoords) {
                                await this.humanClick(page, plusCoords.x, plusCoords.y, { humanConfig: { idle_between_actions: false } });
                                await this.sleep(1200 + Math.random() * 500);
                            }
                        }
                    }
                };

                // Open dialog
                await clickPlusAndOpenDialog();

                // Quyết định: batch upload hay gallery-only
                const isPending = pendingUpload.includes(singleFile);
                let selected;

                if (isPending) {
                    // === BATCH UPLOAD: Tải tất cả ảnh mới cùng lúc ===
                    selected = await this.batchUploadAndSelectFirst(page, singleFile, pendingUpload, angularUpload);
                    // Sau batch upload, thêm tất cả vào cache và xóa pendingUpload
                    if (selected.details?.angularDetail) {
                        const pendingIndex = pendingUpload.indexOf(singleFile);
                        if (pendingIndex !== -1) pendingUpload.splice(pendingIndex, 1);
                    } else {
                        for (const p of pendingUpload) {
                            this._uploadedImages.add(path.resolve(p).toLowerCase());
                        }
                        pendingUpload.length = 0;
                    }
                } else {
                    // === GALLERY-ONLY: Ảnh đã upload, chỉ cần tìm và chọn ===
                    selected = await this.selectFromGalleryOnly(page, singleFile);
                }

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
                // Close dialog if still open as cleanup
                const dialogStillOpen = await page.locator('[role="dialog"]').isVisible().catch(() => false);
                if (dialogStillOpen) {
                    this.log('[Upload] Closing dialog before next file...');
                    await page.keyboard.press('Escape');
                    await this.sleep(500);
                }

            }
        }

        if (totalUploaded === 0) {
            this.log('[Upload] Khong upload duoc file nao. Bo qua.');
            return;
        }

        this.log(`[Upload] Da upload & attach ${totalUploaded}/${pathsToUpload.length} file thanh cong.`);

        // Final check for policy errors
        const finalCheck = await page.evaluate(() => {
            const alerts = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"], [class*="snackbar"], snack-bar'));
            for (let a of alerts) {
                const t = (a.textContent || '').toLowerCase();
                if (a.offsetParent !== null && t.length > 5) {
                    if (t.includes('policy') || t.includes('could not upload') || t.includes('unsupported') ||
                        t.includes('file too large') || t.includes('upload failed') || t.includes('not allowed')) {
                        return { status: 'error', message: (a.textContent || '').trim() };
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
        const attachmentComplete = angularUpload
            ? await require('./flowUpload').countAngularPromptMedia(page) >= pathsToUpload.length
            : await page.evaluate(({ expectedCount }) => {
            const cards = Array.from(document.querySelectorAll('button[data-card-open][data-state]')).filter(card => {
                const img = card.querySelector('img[src*="media.getMediaUrlRedirect"]');
                if (!img) return false;
                const hasCancelIcon = Array.from(card.querySelectorAll('i, span, div, button')).some(el => {
                    const txt = (el.textContent || '').trim().toLowerCase();
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
            const progressTexts = texts.map(el => (el.textContent || '').trim()).filter(t => {
                return t.endsWith('%') && t.length > 1 && t.length <= 4 && !isNaN(parseInt(t));
            });
            const hasProgress = progressTexts.length > 0;
            return cards.length >= expectedCount && !hasProgress;
        }, { expectedCount: pathsToUpload.length }).catch(() => false);

        if (attachmentComplete) {
            this.log(`[Upload] [attached_to_composer_by_card] Attachment card da duoc verify day du (${pathsToUpload.length}/${pathsToUpload.length}). Cho them 800-1200ms de on dinh truoc khi Submit.`);
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
                const txt = (el.textContent || '').toLowerCase();
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
                const txt = (el.textContent || '').toLowerCase();
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
        await this.sleep(1500 + Math.random() * 1000);
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
                        firstItemCoords = { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (firstOption.textContent || '').substring(0, 30) };
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
                    await this.sleep(1500 + Math.random() * 1000);
                    if (await this.verifyI2VStartSlotHasImage(page)) {
                        this.log('[I2V-Confirm] Lớp 2 thành công! Đã chèn bằng nút xác nhận.');
                        return true;
                    }
                }
            } else if (galleryState.firstItemCoords) {
                // Ảnh CHƯA CHỌN → double click gallery item đầu tiên
                this.log(`[I2V-Confirm] Lớp 2: Ảnh chưa được chọn. Double click gallery item: "${galleryState.firstItemCoords.text}"`);
                await this.humanClick(page, galleryState.firstItemCoords.x, galleryState.firstItemCoords.y, { clickCount: 2 });
                await this.sleep(1500 + Math.random() * 1000);
                if (await this.verifyI2VStartSlotHasImage(page)) {
                    this.log('[I2V-Confirm] Lớp 2 thành công! Đã chèn bằng double click.');
                    return true;
                }
                // Double click có thể chỉ chọn chứ không confirm → thử click nút confirm luôn
                const clicked = await this._clickConfirmButtonInDialog(page);
                if (clicked) {
                    await this.sleep(1500 + Math.random() * 1000);
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
                await this.sleep(1500 + Math.random() * 1000);
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

                const txt = (btn.textContent || '').trim().toLowerCase();
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

                const txt = (btn.textContent || '').trim().toLowerCase();
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

                const txt = (btn.textContent || '').trim().toLowerCase();
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
        for (let waitAttempt = 1; waitAttempt <= 8; waitAttempt++) {
            this.log(`[I2V] Tìm ô "Bắt đầu" (First frame) để tải lên (Lần ${waitAttempt}/8)...`);

            let slotLoc = page.locator('div[aria-haspopup="dialog"]').filter({
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
                // Priority 1: Dùng aria-haspopup="dialog"
                const list1 = Array.from(document.querySelectorAll('div[aria-haspopup="dialog"]')).filter(el => {
                    const txt = (el.textContent || '').toLowerCase();
                    return txt.includes('bắt đầu') || txt.includes('start') || txt.includes('first frame');
                });
                if (list1.length > 0) return list1[0];

                // Priority 2: Dùng type="button"
                const list2 = Array.from(document.querySelectorAll('div[type="button"]')).filter(el => {
                    const txt = (el.textContent || '').toLowerCase();
                    return txt.includes('bắt đầu') || txt.includes('start') || txt.includes('first frame');
                });
                if (list2.length > 0) return list2[0];

                // Priority 3: Fallback sibling "Kết thúc" / "End" / "Last frame"
                const endSlot = Array.from(document.querySelectorAll('div[type="button"], div[aria-haspopup="dialog"]'))
                    .find(el => /kết thúc|end|last frame/i.test(el.textContent || ''));
                if (endSlot && endSlot.parentElement) {
                    const siblings = Array.from(endSlot.parentElement.querySelectorAll('div[type="button"], div[aria-haspopup="dialog"]'));
                    const startSlot = siblings.find(el => el !== endSlot && !/kết thúc|end|last frame/i.test(el.textContent || ''));
                    if (startSlot) return startSlot;
                }

                // Priority 4: Fallback prompt editor data-slate-editor / role="textbox"
                const promptEditor = document.querySelector('[data-slate-editor="true"], [role="textbox"]');
                if (promptEditor) {
                    let curr = promptEditor.parentElement;
                    for (let d = 0; d < 5 && curr; d++) {
                        const startSlot = curr.querySelector('div[aria-haspopup="dialog"], div[type="button"]');
                        if (startSlot && /bắt đầu|start|first frame/i.test(startSlot.textContent || '')) {
                            return startSlot;
                        }
                        curr = curr.parentElement;
                    }
                }

                return null;
            }).catch(() => null);

            if (boxHandle) {
                boxElement = boxHandle.asElement();
                if (boxElement) {
                    this.log(`[I2V] Định vị ô "Bắt đầu" qua fallback evaluate.`);
                    break;
                }
            }

            await this.sleep(1500 + Math.random() * 1000);
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
                const allText = document.body.textContent || '';
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
                        let slotLoc = page.locator('div[aria-haspopup="dialog"]').filter({
                            hasText: /Bắt đầu|Start|First frame/i
                        }).first();
                        if (await slotLoc.count() === 0) {
                            slotLoc = page.locator('div[type="button"]').filter({
                                hasText: /Bắt đầu|Start|First frame/i
                            }).first();
                        }
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
                // LAST RESORT: page reload + retry 3 lần
                this.log('[I2V] 🔄 Last resort: page reload + retry...');
                await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                this.settingsApplied = false;
                this._lastAppliedSettings = null;
                await this.sleep(3000 + Math.random() * 2000);

                // Re-setup I2V mode
                const recoveryJob = this._currentJob || { TYPE_VIDEO: 'I2V', settings: this._currentJobSettings || {} };
                await this.setupCreateMenu(page, recoveryJob).catch(() => {});
                await this.sleep(2000);

                for (let lastRetry = 1; lastRetry <= 3; lastRetry++) {
                    let slotLoc = page.locator('div[aria-haspopup="dialog"]').filter({
                        hasText: /Bắt đầu|Start|First frame/i
                    }).first();
                    if (await slotLoc.count() === 0) {
                        slotLoc = page.locator('div[type="button"]').filter({
                            hasText: /Bắt đầu|Start|First frame/i
                        }).first();
                    }
                    if (await slotLoc.count() > 0 && await slotLoc.isVisible().catch(() => false)) {
                        boxElement = await slotLoc.elementHandle().catch(() => null);
                        if (boxElement) {
                            this.log(`[I2V] ✅ Tìm thấy ô "Bắt đầu" sau page reload (lần ${lastRetry}).`);
                            break;
                        }
                    }

                    // Fallback evaluate sau reload
                    const boxHandle = await page.evaluateHandle(() => {
                        const list1 = Array.from(document.querySelectorAll('div[aria-haspopup="dialog"]')).filter(el => {
                            const txt = (el.textContent || '').toLowerCase();
                            return txt.includes('bắt đầu') || txt.includes('start') || txt.includes('first frame');
                        });
                        if (list1.length > 0) return list1[0];
                        const list2 = Array.from(document.querySelectorAll('div[type="button"]')).filter(el => {
                            const txt = (el.textContent || '').toLowerCase();
                            return txt.includes('bắt đầu') || txt.includes('start') || txt.includes('first frame');
                        });
                        if (list2.length > 0) return list2[0];
                        const endSlot = Array.from(document.querySelectorAll('div[type="button"], div[aria-haspopup="dialog"]'))
                            .find(el => /kết thúc|end|last frame/i.test(el.textContent || ''));
                        if (endSlot && endSlot.parentElement) {
                            const siblings = Array.from(endSlot.parentElement.querySelectorAll('div[type="button"], div[aria-haspopup="dialog"]'));
                            const startSlot = siblings.find(el => el !== endSlot && !/kết thúc|end|last frame/i.test(el.textContent || ''));
                            if (startSlot) return startSlot;
                        }
                        return null;
                    }).catch(() => null);

                    if (boxHandle) {
                        boxElement = boxHandle.asElement();
                        if (boxElement) {
                            this.log(`[I2V] ✅ Tìm thấy ô "Bắt đầu" qua fallback evaluate sau page reload (lần ${lastRetry}).`);
                            break;
                        }
                    }
                    await this.sleep(2000);
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

            // 4a-direct: Thử upload qua input[type="file"] ẩn trước (không mở dialog OS)
            const fileInput = page.locator('[role="dialog"] input[type="file"], div[class*="dialog"] input[type="file"], input[type="file"]').first();
            let directUploadSuccess = false;

            if (await fileInput.count().catch(() => 0) > 0) {
                this.log(`[I2V] Direct file input found. Uploading without OS dialog: ${fileName}`);
                try {
                    await fileInput.setInputFiles([cleanStart]);
                    await this.sleep(1500 + Math.random() * 1000);
                    directUploadSuccess = true;
                    this.log('[I2V] ✅ Direct file input upload thành công.');
                } catch (err) {
                    this.log(`[I2V] Direct file input upload failed: ${err.message}. Falling back to click-chooser...`);
                }
            }

            // 4a-fallback: Nếu không có input[type="file"] hoặc upload trực tiếp thất bại → dùng click-based filechooser
            if (!directUploadSuccess) {
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
                                    const t = (el.textContent || '').trim().toLowerCase();
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

                const chooseDelay = 1000 + Math.floor(Math.random() * 1000);
                this.log(`[I2V] File Chooser opened. Giả lập chọn file trên OS trong ${chooseDelay}ms...`);
                await this.sleep(chooseDelay);

                this.log(`[I2V] Setting file: ${fileName}`);
                await fileChooser.setFiles([cleanStart]);

                // Giả lập Window nhận lại tập trung
                await page.evaluate(() => {
                    window.dispatchEvent(new Event('focus'));
                    try { Object.defineProperty(document, 'hasFocus', { get: () => true, configurable: true }); } catch (e) { }
                }).catch(() => { });
            }

            // 4b: Chờ ảnh upload xong và xuất hiện trong gallery (3-6 giây)
            this.log('[I2V] Chờ ảnh upload hoàn tất và xuất hiện trong gallery (3-6s)...');
            await this.sleep(2000 + Math.random() * 2000);

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
                            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (first.textContent || '').substring(0, 30) };
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

        this.log('[I2V] ✅ Upload I2V Frame thành công! Cho 2-3s để hoàn tất xử lý UI...');
        await this.sleep(2000 + Math.random() * 1000);
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
            const closingBrowser = this.browser;
            try {
                const childProcess = typeof closingBrowser.process === 'function' ? closingBrowser.process() : null;
                if (childProcess) {
                    browserPid = childProcess.pid;
                }
            } catch (e) { }
            // Playwright BrowserContext has no process(); closing must not depend on it.
            try { await closingBrowser.close(); } catch (e) { }
            if (this.browser === closingBrowser) {
                this.browser = null;
                this.page = null;
                this.blankPage = null;
            }
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
                const { execFile } = require('child_process');
                const { promisify } = require('util');
                const execFileAsync = promisify(execFile);
                const escaped = this.profilePath.replace(/\\/g, '\\\\');
                const psCmd = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${escaped}') } | Select-Object -ExpandProperty ProcessId`;
                
                const { stdout } = await Promise.race([
                    execFileAsync('powershell', ['-NoProfile', '-Command', psCmd], { encoding: 'utf-8' }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('zombie-cleanup-timeout')), 5000))
                ]);
                
                const pidOutput = (stdout || '').trim();
                if (pidOutput) {
                    const pids = pidOutput.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
                    for (const pid of pids) {
                        try {
                            await Promise.race([
                                execFileAsync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore' }),
                                new Promise((_, reject) => setTimeout(() => reject(new Error('taskkill-timeout')), 3000))
                            ]);
                        } catch (e) { /* already exited or timed out */ }
                    }
                }
            } catch (e) { /* non-fatal: no matching processes or timeout */ }
        }
    }



    async processJob(jobData, outputDir) {
        this.isBusy = true;
        this.currentJobId = jobData.JOB_ID;
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
        this.log('[Worker] 🤖 STEP 1/9: Khởi động trình duyệt 🤖');

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
        while (!isFlowUrl(url) && retries < 3) {
            if (url.includes('accounts.google.com') || url.includes('signin') || url.includes('AccountChooser')) {
                this.log('[STEP 1] Redirected to Google login page. Breaking navigation loop to handle session restoration.');
                break;
            }
            this.log(`[STEP 1] Navigating to Veo3 (Attempt ${retries + 1}/3)...`);
            try {
                await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
                await page.waitForFunction('document.readyState === "complete" || document.readyState === "interactive"', { timeout: 10000 });
                navigated = true;
            } catch (navErr) {
                this.log(`[STEP 1] Navigation error: ${navErr.message}`);
            }
            await this.sleep(800 + Math.random() * 700);
            url = await page.url();
            retries++;
        }

        if (isFlowUrl(url)) {
            await page.waitForFunction(() => !!document.querySelector('[data-slate-editor="true"], textarea, img[src*="googleusercontent.com"]') ||
                Array.from(document.querySelectorAll('button, a, [role="button"]')).some(el => /new project|create project|dự án mới|tạo dự án|create with|tạo bằng|sign in|đăng nhập/i.test(el.textContent || '')),
                null, { timeout: 15000 }).catch(() => {});
        }
        let isLoggedIn = await page.evaluate(() => {
            const html = document.documentElement.innerHTML.toLowerCase();
            const hasSignInBtn = html.includes('sign in with google') || html.includes('đăng nhập bằng google') || html.includes('sign in to continue') || html.includes('authjs.dev/img/providers') || window.location.href.includes('/api/auth/signin');
            const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
            const hasNewProject = textNodes.some(el => {
                if (!el.textContent) return false;
                const t = el.textContent.trim().toLowerCase();
                return t.includes('dự án mới') ||
                    t.includes('new project') ||
                    t.includes('create new project');
            });
            const hasPrompt = !!document.querySelector('[data-slate-editor="true"][role="textbox"], textarea[aria-label*="Prompt"]');
            const inProject = (['labs.google', 'flow.google.com'].includes(window.location.hostname) && /\/project\/[^/?#]+/.test(window.location.pathname));
            // Fast signals: user avatar (renders immediately in header)
            const hasUserAvatar = !!document.querySelector('img[src*="googleusercontent.com"]');
            return !hasSignInBtn && (hasNewProject || hasPrompt || inProject || hasUserAvatar);
        }).catch(() => false);

        // Session freshness check: If not logged in, try restoring cookies from disk first
        if (!isLoggedIn || url.includes('accounts.google.com') || url.includes('signin') || url.includes('AccountChooser')) {
            this.log('[STEP 1] Session not active. Attempting to restore session from disk cookies...');
            const cookieFilePath = path.join(this.profilePath, 'auth-cookies.json');
            if (fs.existsSync(cookieFilePath)) {
                try {
                    const content = fs.readFileSync(cookieFilePath, 'utf8');
                    const cookies = JSON.parse(content);
                    if (cookies && cookies.length > 0) {
                        await this.browser.addCookies(cookies);
                        this.log(`[STEP 1] Injected ${cookies.length} auth cookies from disk to restore session.`);
                        // Reload and check again
                        await page.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
                        await this.sleep(1500 + Math.random() * 1000);
                        url = await page.url();

                        isLoggedIn = await page.evaluate(() => {
                            const html = document.documentElement.innerHTML.toLowerCase();
                            const hasSignInBtn = html.includes('sign in with google') || html.includes('đăng nhập bằng google') || html.includes('sign in to continue') || html.includes('authjs.dev/img/providers') || window.location.href.includes('/api/auth/signin');
                            const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
                            const hasNewProject = textNodes.some(el => {
                                if (!el.textContent) return false;
                                const t = el.textContent.trim().toLowerCase();
                                return t.includes('dự án mới') ||
                                    t.includes('new project') ||
                                    t.includes('create new project');
                            });
                            const hasPrompt = !!document.querySelector('[data-slate-editor="true"][role="textbox"], textarea[aria-label*="Prompt"]');
                            const inProject = (['labs.google', 'flow.google.com'].includes(window.location.hostname) && /\/project\/[^/?#]+/.test(window.location.pathname));
                            const hasUserAvatar = !!document.querySelector('img[src*="googleusercontent.com"]');
                            return !hasSignInBtn && (hasNewProject || hasPrompt || inProject || hasUserAvatar);
                        }).catch(() => false);
                    }
                } catch (err) {
                    this.log(`[STEP 1] Failed to restore cookies from disk during freshness check: ${err.message}`);
                }
            }
        }

        // If STILL not logged in, fallback to full login sequence
        if (!isLoggedIn || url.includes('accounts.google.com') || url.includes('signin') || url.includes('AccountChooser')) {
            this.log('[STEP 1] Session restore from disk failed/not available. Fallback to full login sequence...');
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
            if (!isFlowUrl(currentUrl)) {
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

        // Helper: check if we're already in workspace/gallery (no intro CTA needed)
        const checkAlreadyInWorkspace = async () => {
            return await page.evaluate(() => {
                // Editor = already in project
                if (document.querySelector('[data-slate-editor="true"][role="textbox"]')) return true;
                const textNodes = Array.from(document.querySelectorAll('div, span, button, a'));
                // Gallery page with "New Project" button
                if (textNodes.some(el => el.textContent && /dự án mới|new project|create project|tạo dự án/i.test(el.textContent))) return true;
                // User avatar = logged in (fast signal, renders before gallery cards)
                if (document.querySelector('img[src*="googleusercontent.com"]')) return true;
                return false;
            }).catch(() => false);
        };

        try {
            // Try up to 3 times to find and click the intro CTA button
            for (let attempt = 0; attempt < 10; attempt++) {
                const loopUrl = await page.url();
                if (loopUrl.includes('accounts.google.com') || loopUrl.includes('signin') || loopUrl.includes('AccountChooser')) {
                    throw new Error('[STEP 2] Redirected to Google Login during CTA click attempts.');
                }

                // Subsequent jobs stay in the same project. The Angular workspace
                // need not contain a Slate editor, New Project button or avatar.
                // STEP 4 verifies the project before the generation steps proceed.
                if (isFlowProjectUrl(loopUrl)) {
                    this.log('[STEP 2] Already in an active Flow project; skipping intro CTA.');
                    return;
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
                    // No CTA button found — check if we're already in workspace/gallery
                    const inWorkspace = await checkAlreadyInWorkspace();

                    if (inWorkspace) {
                        this.log('[STEP 2] Already in workspace/gallery (no intro CTA needed), skipping.');
                        return;
                    }

                    // URL still on Flow but workspace not detected yet — retry with wait
                    // (gallery cards load async, avatar may not have rendered yet)
                    if (attempt < 9 && isFlowUrl(loopUrl)) {
                        this.log(`[STEP 2] CTA not found, workspace not detected yet (attempt ${attempt + 1}/10). Waiting for page to hydrate...`);
                        await this.sleep(2000 + Math.random() * 1000);
                        continue;
                    }

                    throw new Error(`[STEP 2] CTA button not found and not in workspace. URL: ${loopUrl.split(/[?#]/)[0]}`);
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
                this.log(`[STEP 2] Still on intro page after click (attempt ${attempt + 1}/10). Retrying...`);
                await this.sleep(1000 + Math.random() * 500);
            }
            throw new Error('[STEP 2] Could not click intro button after 10 attempts.');
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
        const inActiveProject = isFlowProjectUrl(currentUrl);
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
            const newProjBtn = page.locator('button:visible, [role="button"]:visible').filter({ hasText: /Dự án mới|New project|Tạo dự án|Create project/i }).last();
            await newProjBtn.waitFor({ state: 'visible', timeout: 5000 });
            this.log('[STEP 3] Clicking "Dự án mới" via locator...');
            await newProjBtn.click();
            await this.sleep(1000 + Math.random() * 500);
        } catch (e) {
            const loopUrl = await page.url();
            if (loopUrl.includes('accounts.google.com') || loopUrl.includes('signin') || loopUrl.includes('AccountChooser')) {
                throw new Error('[STEP 3] Redirected to Google Login during New Project click.');
            }
            const inProject = isFlowProjectUrl(loopUrl);
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
        while (!isFlowProjectUrl(currentUrl) && retry < 3) {
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

        if (!isFlowProjectUrl(currentUrl)) {
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

        // Let the page transition and DOM settle down (wait for panel + CSS classes to fully load)
        await this.sleep(6000);

        // ============ SUB-STEP A: Close Agent Chat Panel ============
        try {
            this.log('[STEP 4.5a] Checking for Agent chat panel...');
            const chatPanelClose = await page.evaluate(() => {
                const isVisible = (el) => {
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                };

                // Strategy 1 (Primary): Class-based detection with known Google Flow close button classes
                // Updated from user's DOM: sc-31f9b501-4 / dFZHoC (previously sc-9972d1c3-4 / BPRCp)
                const allBtns = Array.from(document.querySelectorAll('button'));

                for (const btn of allBtns) {
                    if (!isVisible(btn)) continue;

                    const r = btn.getBoundingClientRect();
                    // Must be on the right side of the screen
                    if (r.x < window.innerWidth * 0.4) continue;

                    const classes = Array.from(btn.classList);
                    // Match known agent panel close button classes (check both old and new)
                    const hasKnownClass = classes.includes('dFZHoC') || classes.includes('BPRCp') ||
                        classes.some(c => c.includes('sc-31f9b501') || c.includes('sc-9972d1c3'));

                    if (hasKnownClass) {
                        // Verify it has close icon or close text inside
                        const icon = btn.querySelector('i.google-symbols, .google-symbols');
                        const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
                        const span = btn.querySelector('span');
                        const spanText = span ? (span.textContent || '').trim().toLowerCase() : '';
                        const isWrongBtn = iconText === 'menu' || spanText.includes('nhật ký');

                        if (!isWrongBtn && (iconText === 'close' || ['đóng', 'close'].includes(spanText))) {
                            return {
                                found: true,
                                x: r.x + r.width / 2,
                                y: r.y + r.height / 2,
                                method: 'class-match',
                                classes: classes.join(' ')
                            };
                        }
                    }
                }

                // Strategy 2 (Fallback): Text/icon + parent context scoring (no class dependency)
                const candidates = [];
                for (const btn of allBtns) {
                    if (!isVisible(btn)) continue;

                    const r = btn.getBoundingClientRect();
                    if (r.x < window.innerWidth * 0.4) continue;
                    if (r.width > 80 || r.height > 80) continue;

                    const icon = btn.querySelector('i.google-symbols, .google-symbols, i[class*="symbol"]');
                    const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
                    const span = btn.querySelector('span');
                    const spanText = span ? (span.textContent || '').trim().toLowerCase() : '';
                    const fullText = (btn.textContent || '').trim().toLowerCase();
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

                    const hasCloseIcon = iconText === 'close';
                    const hasCloseText = ['đóng', 'close'].includes(spanText) ||
                        ariaLabel.includes('đóng') || ariaLabel.includes('close');
                    const isWrongBtn = iconText === 'menu' || fullText.includes('nhật ký') ||
                        fullText.includes('log') || fullText.includes('settings');

                    if (isWrongBtn || (!hasCloseIcon && !hasCloseText)) continue;

                    // Score parent context
                    let parentEl = btn.parentElement;
                    let depth = 0;
                    let panelScore = 0;
                    while (parentEl && depth < 15) {
                        if (parentEl.tagName === 'BODY' || parentEl.tagName === 'HTML') break;
                        const pText = (parentEl.textContent || '').toLowerCase();
                        if (pText.includes('phiên không có tiêu đề') || pText.includes('untitled session')) panelScore += 3;
                        if (pText.includes('chào') || pText.includes('bạn muốn làm gì') || pText.includes('what do you want')) panelScore += 2;
                        if (pText.includes('tác nhân') || pText.includes('agent')) panelScore += 2;
                        if (pText.includes('biến ý tưởng thành câu lệnh')) panelScore += 2;
                        if (pText.includes('dự án mới') || pText.includes('new project')) {
                            panelScore = 0;
                            break;
                        }
                        if (panelScore > 0) break;
                        parentEl = parentEl.parentElement;
                        depth++;
                    }

                    if (panelScore > 0) {
                        candidates.push({
                            found: true,
                            x: r.x + r.width / 2,
                            y: r.y + r.height / 2,
                            score: panelScore,
                            method: hasCloseIcon ? 'fallback-close-icon' : 'fallback-close-text'
                        });
                    }
                }

                // Return best candidate (highest score)
                if (candidates.length > 0) {
                    candidates.sort((a, b) => b.score - a.score);
                    return candidates[0];
                }

                // Fallback: Try the generic close button with "✕" or "×" on right side
                for (const btn of allBtns) {
                    if (!isVisible(btn)) continue;
                    const r = btn.getBoundingClientRect();
                    if (r.x < window.innerWidth * 0.5) continue;
                    if (r.width > 50 || r.height > 50) continue;
                    const text = (btn.textContent || '').trim();
                    if (text === '✕' || text === '×' || text === 'close') {
                        let parentEl2 = btn.parentElement;
                        let isAgent = false;
                        for (let d = 0; d < 10 && parentEl2; d++) {
                            const pt = (parentEl2.textContent || '').toLowerCase();
                            if (pt.includes('tác nhân') || pt.includes('agent') || pt.includes('phiên không có tiêu đề') || pt.includes('chào')) {
                                isAgent = true; break;
                            }
                            parentEl2 = parentEl2.parentElement;
                        }
                        if (isAgent) return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, method: 'fallback-x-btn' };
                    }
                }

                return { found: false };
            }).catch(() => ({ found: false }));

            if (chatPanelClose.found) {
                this.log(`[STEP 4.5a] ⚠ Agent chat panel detected (${chatPanelClose.method}). Clicking close button...`);
                let panelClosed = false;
                let currentCloseBtn = chatPanelClose;

                for (let attempt = 1; attempt <= 3; attempt++) {
                    await this.humanClick(page, currentCloseBtn.x, currentCloseBtn.y);
                    await this.sleep(1500 + Math.random() * 500);

                    // Re-evaluate if chat panel close button is still present
                    const reCheck = await page.evaluate(() => {
                        const isVisible = (el) => {
                            const style = window.getComputedStyle(el);
                            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
                            const r = el.getBoundingClientRect();
                            return r.width > 0 && r.height > 0;
                        };
                        const allBtns = Array.from(document.querySelectorAll('button'));
                        const candidates = [];
                        for (const btn of allBtns) {
                            if (!isVisible(btn)) continue;
                            const r = btn.getBoundingClientRect();
                            const icon = btn.querySelector('i.google-symbols, .google-symbols, i[class*="symbol"]');
                            const iconText = icon ? (icon.textContent || '').trim().toLowerCase() : '';
                            const span = btn.querySelector('span');
                            const spanText = span ? (span.textContent || '').trim().toLowerCase() : '';
                            const fullText = (btn.textContent || '').trim().toLowerCase();
                            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

                            const hasCloseIcon = iconText === 'close';
                            const hasCloseText = ['đóng', 'close'].includes(spanText) ||
                                ariaLabel.includes('đóng') || ariaLabel.includes('close');
                            const isWrongBtn = iconText === 'menu' || fullText.includes('nhật ký') ||
                                fullText.includes('log') || fullText.includes('settings');

                            if (isWrongBtn || (!hasCloseIcon && !hasCloseText)) continue;

                            let parentEl = btn.parentElement;
                            let depth = 0;
                            let panelScore = 0;
                            while (parentEl && depth < 15) {
                                if (parentEl.tagName === 'BODY' || parentEl.tagName === 'HTML') break;
                                const pText = (parentEl.textContent || '').toLowerCase();
                                if (pText.includes('phiên không có tiêu đề') || pText.includes('untitled session')) panelScore += 3;
                                if (pText.includes('chào') || pText.includes('bạn muốn làm gì') || pText.includes('what do you want')) panelScore += 2;
                                if (pText.includes('tác nhân') || pText.includes('agent')) panelScore += 2;
                                if (pText.includes('biến ý tưởng thành câu lệnh')) panelScore += 2;
                                if (pText.includes('dự án mới') || pText.includes('new project')) {
                                    panelScore = 0;
                                    break;
                                }
                                if (panelScore > 0) break;
                                parentEl = parentEl.parentElement;
                                depth++;
                            }

                            if (panelScore > 0) {
                                candidates.push({
                                    found: true,
                                    x: r.x + r.width / 2,
                                    y: r.y + r.height / 2,
                                    score: panelScore,
                                    method: hasCloseIcon ? 'fallback-close-icon' : 'fallback-close-text'
                                });
                            }
                        }

                        if (candidates.length > 0) {
                            candidates.sort((a, b) => b.score - a.score);
                            return candidates[0];
                        }

                        // Fallback generic X
                        for (const btn of allBtns) {
                            if (!isVisible(btn)) continue;
                            const r = btn.getBoundingClientRect();
                            if (r.x < window.innerWidth * 0.5) continue;
                            if (r.width > 50 || r.height > 50) continue;
                            const text = (btn.textContent || '').trim();
                            if (text === '✕' || text === '×' || text === 'close') {
                                let parentEl2 = btn.parentElement;
                                let isAgent = false;
                                for (let d = 0; d < 10 && parentEl2; d++) {
                                    const pt = (parentEl2.textContent || '').toLowerCase();
                                    if (pt.includes('tác nhân') || pt.includes('agent') || pt.includes('phiên không có tiêu đề') || pt.includes('chào')) {
                                        isAgent = true; break;
                                    }
                                    parentEl2 = parentEl2.parentElement;
                                }
                                if (isAgent) return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, method: 'fallback-x-btn' };
                            }
                        }
                        return { found: false };
                    }).catch(() => ({ found: false }));

                    if (!reCheck.found) {
                        panelClosed = true;
                        this.log(`[STEP 4.5a] ✓ Agent chat panel successfully closed on attempt ${attempt}.`);
                        break;
                    } else {
                        this.log(`[STEP 4.5a] ⚠ Attempt ${attempt}/3 to close Agent chat panel failed. Retrying...`);
                        currentCloseBtn = reCheck;
                    }
                }

                if (!panelClosed) {
                    this.log(`[STEP 4.5a] ❌ FAILED to close Agent chat panel after 3 attempts. Attempting emergency Escape key...`);
                    await page.keyboard.press('Escape');
                    await this.sleep(1000);
                }
            } else {
                this.log('[STEP 4.5a] No agent chat panel detected. Skipping.');
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

                // Strategy: Find agent toggle using text + aria-pressed (NO hardcoded CSS classes)
                const allBtns = Array.from(document.querySelectorAll('button'));
                for (const btn of allBtns) {
                    if (!isVisible(btn)) continue;

                    const r = btn.getBoundingClientRect();

                    // Text-based detection
                    const spanContent = btn.querySelector('span');
                    const spanText = spanContent ? (spanContent.textContent || '').trim().toLowerCase() : '';
                    const fullText = (btn.textContent || '').trim().toLowerCase();
                    const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();

                    const isAgentText = spanText === 'tác nhân' || spanText === 'agent' ||
                        fullText === 'tác nhân' || fullText === 'agent' ||
                        ariaLabel === 'tác nhân' || ariaLabel === 'agent';

                    if (!isAgentText) continue;

                    // Found it! Check if it has aria-pressed
                    const pressed = btn.getAttribute('aria-pressed');
                    return {
                        found: true,
                        pressed: pressed === 'true',
                        x: r.x + r.width / 2,
                        y: r.y + r.height / 2,
                        text: fullText.substring(0, 30),
                        method: 'text-and-aria'
                    };
                }
                return { found: false };
            }).catch(() => ({ found: false }));

            if (!agentBtnInfo.found) {
                this.log('[STEP 4.5b] Agent toggle button not found on page. Skipping.');
                return;
            }

            if (agentBtnInfo.pressed) {
                this.log(`[STEP 4.5b] ⚠ Agent button "${agentBtnInfo.text}" is ACTIVE (aria-pressed=true). Clicking to deactivate...`);
                let deactivated = false;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    await this.humanClick(page, agentBtnInfo.x, agentBtnInfo.y);
                    await this.sleep(1500 + Math.random() * 500);

                    // Re-evaluate current button coordinates and pressed state
                    const currentBtn = await page.evaluate(() => {
                        const isVisible = (el) => {
                            const style = window.getComputedStyle(el);
                            if (style.display === 'none' || style.visibility === 'hidden') return false;
                            const r = el.getBoundingClientRect();
                            return r.width > 0 && r.height > 0;
                        };
                        const allBtns = Array.from(document.querySelectorAll('button'));
                        for (const btn of allBtns) {
                            if (!isVisible(btn)) continue;
                            const fullText = (btn.textContent || '').trim().toLowerCase();
                            const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                            if (fullText === 'tác nhân' || fullText === 'agent' || ariaLabel === 'tác nhân' || ariaLabel === 'agent') {
                                const r = btn.getBoundingClientRect();
                                return {
                                    pressed: btn.getAttribute('aria-pressed') === 'true',
                                    x: r.x + r.width / 2,
                                    y: r.y + r.height / 2
                                };
                            }
                        }
                        return null;
                    }).catch(() => null);

                    if (!currentBtn || !currentBtn.pressed) {
                        deactivated = true;
                        this.log(`[STEP 4.5b] ✓ Agent button successfully deactivated on attempt ${attempt}.`);
                        break;
                    } else {
                        this.log(`[STEP 4.5b] ⚠ Attempt ${attempt}/3 to deactivate Agent button failed. Retrying...`);
                        agentBtnInfo.x = currentBtn.x;
                        agentBtnInfo.y = currentBtn.y;
                    }
                }

                if (!deactivated) {
                    this.log(`[STEP 4.5b] ❌ FAILED to deactivate Agent button after 3 attempts. Attempting emergency Escape key...`);
                    await page.keyboard.press('Escape');
                    await this.sleep(1000);
                }
            } else {
                this.log(`[STEP 4.5b] ✓ Agent button "${agentBtnInfo.text}" is already OFF (aria-pressed=false). No action needed.`);
            }
        } catch (e) {
            this.log(`[STEP 4.5b] Warning: Agent button toggle failed: ${e.message}. Continuing pipeline...`);
        }
    }


    async setupViewMode(page) {
        if (await page.locator('button.settings-trigger-button:visible').count()) {
            this.log('[STEP 5] Angular Flow detected; generation settings are handled in STEP 6.');
            return;
        }
        this.log('[Worker] 🤖 STEP 5/9: Setup View Mode 🤖');

        // Skip entirely if already applied (no waiting needed)
        if (this.viewModeApplied) {
            this.log('[STEP 5] View mode already applied.');
            return;
        }

        let panelOpened = false;
        try {
            // Wait for settings gear icon as page readiness signal (max 3s)
            try {
                await page.locator('i.google-symbols').filter({ hasText: 'settings_2' }).first()
                    .waitFor({ state: 'visible', timeout: 3000 });
            } catch (e) {
                this.log('[STEP 5] Settings gear icon not immediately visible, proceeding...');
            }

            this.log('[STEP 5] Applying view mode settings...');

            // Helper: toggle a setting row using fast RegExp matching across languages
            const toggleSetting = async (labelTextList, desiredState) => {
                try {
                    const texts = Array.isArray(labelTextList) ? labelTextList : [labelTextList];
                    const pattern = texts.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                    const regex = new RegExp(pattern, 'i');
                    const label = page.locator('span, div, p').filter({ hasText: regex }).first();
                    if (!await label.isVisible({ timeout: 600 }).catch(() => false)) return;

                    const parentRow = label.locator('xpath=ancestor::div[contains(@class,"lhAacX") or contains(@class,"sc-") or button[aria-controls]]').first();
                    const suffix = desiredState ? '-content-true' : '-content-false';
                    const targetLabel = desiredState ? 'Đang bật' : 'Đang tắt';
                    const btn = parentRow.locator(`button.flow_tab_slider_trigger[aria-controls$="${suffix}"], button[aria-controls$="${suffix}"], button.flow_tab_slider_trigger[aria-label="${targetLabel}"], button.flow_tab_slider_trigger[aria-label="${desiredState ? 'On' : 'Off'}"]`).first();
                    const state = await btn.getAttribute('data-state', { timeout: 800 }).catch(() => '');
                    if (state !== 'active') {
                        this.log(`[STEP 5] Setting "${texts[0]}" → ${desiredState ? 'True' : 'False'}`);
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
                panelOpened = true;
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
                await toggleSetting(['Return silent videos', 'Trả về video không âm thanh', 'Trả về video không tiếng', 'Video không tiếng', 'không có âm thanh'], cfg.returnSilent !== false);

                // 6. Show cell info → Đang bật (Hiện thông tin chi tiết về ô)
                await toggleSetting(['Show cell details', 'Hiện thông tin chi tiết về ô'], true);

                // 7. Clear prompt after send → Đang tắt (Xoá câu lệnh sau khi gửi)
                await toggleSetting(['Clear prompt after sending', 'Xoá câu lệnh sau khi gửi'], false);

                // Close settings panel
                await page.keyboard.press('Escape');
                await this.sleep(250);
            } else {
                this.log('[STEP 5] Settings gear icon not found, skipping...');
            }

            this.log('[STEP 5] ✓ View mode applied.');
        } catch (err) {
            this.log(`[STEP 5] Warning: ${err.message}. Continuing pipeline...`);
        } finally {
            this.viewModeApplied = true;
            // Guarantee settings panel is closed before moving to STEP 6
            if (panelOpened) {
                try {
                    const isStillOpen = await page.locator('[role="dialog"], [role="menu"]').filter({ hasText: /lưới|grid|âm thanh|sound|chi tiết/i }).first().isVisible({ timeout: 300 }).catch(() => false);
                    if (isStillOpen) {
                        this.log('[STEP 5] Panel still open in finally, pressing Escape...');
                        await page.keyboard.press('Escape');
                        await this.sleep(300);
                    }
                } catch (e) { /* ignore */ }
            }
        }
    }

    /**
     * STEP 6: Setup Create Menu & Model Selection
     * Configures: Video/Image tab → Model dropdown → Aspect ratio → Count
     * Model names MUST match exactly with FE settings.vue select options
     */
    async setupCreateMenu(page, job) {
        this.log('[Worker] 🤖 STEP 6/9: Setup Menu & Model 🤖');

        const angularSettings = page.locator('button.settings-trigger-button:visible');
        if (await angularSettings.count()) {
            const config = job.settings || this.automationService?.configManager?.getConfig() || {};
            const { setupFlowSettingsOnce } = require('./flowSettings');
            await setupFlowSettingsOnce(page, job, config, msg => this.log(msg));
            return;
        }

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
            targetModelName = is.model || jobConfig.imgModel || 'Nano Banana 2 Lite';
            if (this.fallbackToProModel) {
                targetModelName = 'Nano Banana Pro';
            }
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
                'T2V': { type: 'selector', value: 'button[aria-controls$="-content-VIDEO"]' },
                'IN2V': { type: 'selector', value: 'button[aria-controls$="-content-VIDEO"]' },
                'I2V': { type: 'selector', value: 'button[aria-controls$="-content-VIDEO"]' },
                'IMG': { type: 'selector', value: 'button[aria-controls$="-content-IMAGE"]' },
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
                'Omni Flash': { type: 'selector', value: '[role="menuitemradio"]:has-text("Omni Flash"), [role="menuitem"]:has-text("Omni Flash"), [role="option"]:has-text("Omni Flash"), button:has-text("Omni Flash")' },
                'Omni 1.1 Flash': { type: 'selector', value: '[role="menuitem"]:has-text("Omni 1.1 Flash"), [role="menuitemradio"]:has-text("Omni 1.1 Flash"), [role="option"]:has-text("Omni 1.1 Flash")' },
                'Veo 3.1 - Lite': { type: 'selector', value: '[role="menuitem"]:has-text("Veo 3.1 - Lite"), [role="menuitemradio"]:has-text("Veo 3.1 - Lite"), [role="option"]:has-text("Veo 3.1 - Lite")' },
                'Veo 3.1 - Lite [Lower Priority]': { type: 'selector', value: '[role="menuitemradio"]:has-text("Veo 3.1 - Lite"), [role="menuitem"]:has-text("Veo 3.1 - Lite"), [role="option"]:has-text("Veo 3.1 - Lite"), button:has-text("Veo 3.1 - Lite"), [role="menuitemradio"]:has-text("Lite"), [role="menuitem"]:has-text("Lite")' },
                'Veo 3.1 - Fast': { type: 'selector', value: '[role="menuitemradio"]:has-text("Veo 3.1 - Fast"), [role="menuitem"]:has-text("Veo 3.1 - Fast"), [role="option"]:has-text("Veo 3.1 - Fast"), button:has-text("Veo 3.1 - Fast"), [role="menuitemradio"]:has-text("Fast"), [role="menuitem"]:has-text("Fast")' },
                'Veo 3.1 - Quality': { type: 'selector', value: '[role="menuitemradio"]:has-text("Veo 3.1 - Quality"), [role="menuitem"]:has-text("Veo 3.1 - Quality"), [role="option"]:has-text("Veo 3.1 - Quality"), button:has-text("Veo 3.1 - Quality"), [role="menuitemradio"]:has-text("Quality"), [role="menuitem"]:has-text("Quality")' },
                'Nano Banana Pro': { type: 'selector', value: '[role="menuitemradio"]:has-text("Nano Banana Pro"), [role="menuitem"]:has-text("Nano Banana Pro"), [role="option"]:has-text("Nano Banana Pro"), button:has-text("Nano Banana Pro")' },
                'Nano Banana 2 Lite': { type: 'selector', value: '[role="menuitemradio"]:has-text("Nano Banana 2 Lite"), [role="menuitem"]:has-text("Nano Banana 2 Lite"), [role="option"]:has-text("Nano Banana 2 Lite"), button:has-text("Nano Banana 2 Lite")' },
                'Nano Banana 2': { type: 'selector', value: '[role="menuitemradio"], [role="menuitem"], [role="option"], button', filterText: /Nano Banana 2(?!\s*Lite)/i },
                'nano banana 2': { type: 'selector', value: '[role="menuitemradio"], [role="menuitem"], [role="option"], button', filterText: /Nano Banana 2(?!\s*Lite)/i },
                'Imagen 3': { type: 'selector', value: '[role="menuitemradio"]:has-text("Imagen 3"), [role="menuitem"]:has-text("Imagen 3"), [role="option"]:has-text("Imagen 3"), button:has-text("Imagen 3")' }
            }
        };

        // Click helper — locator.click() qua CloakBrowser humanize pipeline, chính xác + né bot
        const menuClickOpts = { force: true, humanConfig: { idle_between_actions: false } };
        const clickDynamicNode = async (map, key) => {
            if (!key || !map) return false;
            let c = map[key];
            if (!c) {
                // Try case-insensitive and trimmed key lookup
                const lowerKey = String(key).toLowerCase().trim();
                const matchedKey = Object.keys(map).find(k => k.toLowerCase().trim() === lowerKey);
                if (matchedKey) {
                    c = map[matchedKey];
                }
            }
            if (!c) {
                // Future-proof fallback: dynamically generate a text-based selector for dropdown options
                this.log(`[STEP 6] ⚠ No coords entry for key "${key}". Generating dynamic selector fallback...`);
                c = {
                    type: 'selector',
                    value: `[role="menuitemradio"]:text-is("${key}"), [role="menuitem"]:text-is("${key}"), [role="option"]:text-is("${key}"), button:text-is("${key}")`
                };
            }
            try {
                if (c.type === 'selector') {
                    let loc = page.locator(c.value);
                    if (c.filterText) {
                        loc = loc.filter({ hasText: c.filterText });
                    }
                    loc = loc.first();
                    if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await loc.click(menuClickOpts);
                        await this.sleep(200 + Math.random() * 100);
                        return true;
                    }
                    // Fallback: case-insensitive match when :text-is fails
                    // Veo3 UI prepends emojis to model names (e.g. "🍌 Nano Banana 2 Lite")
                    // so we use a loose regex that allows any prefix before the model name
                    if (c.value.includes(':text-is(')) {
                        const textMatch = c.value.match(/:text-is\("([^"]+)"\)/);
                        if (textMatch) {
                            const targetText = textMatch[1];
                            // Allow any prefix (emoji, icon, whitespace) before the model name
                            const escapedText = targetText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const looseRegex = new RegExp(`${escapedText}\\s*$`, 'i');
                            this.log(`[STEP 6] Exact match :text-is failed for "${targetText}". Trying emoji-tolerant fallback regex: ${looseRegex}...`);
                            const fallbackLoc = page.locator('[role="menuitemradio"], [role="menuitem"], [role="option"]')
                                .filter({ hasText: looseRegex })
                                .last();
                            if (await fallbackLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
                                await fallbackLoc.click(menuClickOpts);
                                await this.sleep(200 + Math.random() * 100);
                                return true;
                            }
                        }
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
                    // Confirmed from the Flow settings summary button's outerHTML.
                    const triggers = page.locator('button.settings-trigger-button:visible');
                    await triggers.first().waitFor({ state: 'visible', timeout: 5000 });
                    const count = await triggers.count();
                    if (count !== 1) {
                        this.log('[STEP 6] Expected one visible settings-trigger-button; found ' + count + '.');
                        return false;
                    }
                    await triggers.click({ timeout: 5000 });
                    this.log('[STEP 6] Clicked settings-trigger-button via DOM locator.');
                    return true;
                } else if (c.type === 'custom' && c.value === 'model_dropdown') {
                    const result = await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        const modelKeywords = ['banana', 'veo', 'omni', 'imagen', 'flash', 'lite', 'quality', 'fast'];
                        
                        const visibleBtns = btns.filter(btn => {
                            const r = btn.getBoundingClientRect();
                            return r.width > 0 && r.height > 0 && btn.offsetParent !== null;
                        });

                        // Strategy 1: Find button containing model names
                        for (const btn of visibleBtns) {
                            const text = (btn.textContent || '').trim().toLowerCase();
                            if (modelKeywords.some(kw => text.includes(kw))) {
                                const r = btn.getBoundingClientRect();
                                return { x: r.x + r.width / 2, y: r.y + r.height / 2, strategy: 'model_keyword', text };
                            }
                        }

                        // Strategy 2: Find button with aria-haspopup="menu" or "listbox" or "true"
                        for (const btn of visibleBtns) {
                            const hasPopup = btn.getAttribute('aria-haspopup');
                            if (hasPopup === 'menu' || hasPopup === 'listbox' || hasPopup === 'true') {
                                const r = btn.getBoundingClientRect();
                                return { x: r.x + r.width / 2, y: r.y + r.height / 2, strategy: 'aria_haspopup', text: btn.textContent };
                            }
                        }

                        // Strategy 3: Find button containing dropdown indicator text/html
                        for (const btn of visibleBtns) {
                            const html = btn.innerHTML.toLowerCase();
                            if (html.includes('arrow') || html.includes('drop') || html.includes('chevron') || html.includes('down')) {
                                const r = btn.getBoundingClientRect();
                                return { x: r.x + r.width / 2, y: r.y + r.height / 2, strategy: 'icon_html', text: btn.textContent };
                            }
                        }

                        return null;
                    }).catch(e => ({ error: e.message }));

                    if (result && result.x && result.y) {
                        this.log(`[STEP 6] model_dropdown found via strategy: ${result.strategy} (text: "${result.text}") at: ${result.x}, ${result.y}`);
                        await this.humanClick(page, result.x, result.y);
                        await this.sleep(200 + Math.random() * 100);
                        return true;
                    }

                    // Fallback to simpler selector
                    this.log(`[STEP 6] model_dropdown evaluate found nothing (err: ${result?.error || 'none'}). Trying fallback selector...`);
                    const loc = page.locator('button[aria-haspopup="menu"]').last();
                    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
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
            let wasClicked = false;
            for (let attempt = 0; attempt <= 2; attempt++) {
                const clicked = await clickDynamicNode(map, key);
                if (clicked) wasClicked = true;
                if (!clicked) {
                    if (attempt < 2) await this.sleep(200);
                    continue;
                }
                await this.sleep(250 + Math.random() * 150); // Slightly more delay to let UI update under load
                if (!verifySelector || await verifyActive(verifySelector, label)) {
                    return { success: true, clicked: true };
                }
                if (attempt < 2) this.log(`[STEP 6] Retry ${attempt + 1}/2 for "${label}"...`);
            }
            this.log(`[STEP 6] ⚠ VERIFY_FAILED: "${label}" after 3 attempts (clicked: ${wasClicked})`);
            return { success: false, clicked: wasClicked };
        };

        const mustClickWithVerify = async (map, key, verifySelector, label) => {
            const res = await clickWithVerify(map, key, verifySelector, label);
            if (!res.success) {
                if (res.clicked) {
                    this.log(`[STEP 6] ⚠️ CLICK_VERIFY_WARNING: "${label}" click succeeded but verification lagged/failed. Proceeding due to potential CPU throttling.`);
                    return true;
                }
                throw new Error(`CLICK_VERIFY_FAILED: ${label} (Element could not be clicked)`);
            }
            return true;
        };

        // Verify generation tabs before choosing a mode.
        const modeTabs = page.locator('button[aria-controls$="-content-VIDEO"]:visible, button[aria-controls$="-content-IMAGE"]:visible').first();
        let opened = await modeTabs.isVisible().catch(() => false);
        if (!opened) await page.keyboard.press('Escape');
        for (let attempt = 0; !opened && attempt < 5; attempt++) {
            const clicked = await clickDynamicNode(coords.modes, 'trigger_create_menu');
            if (clicked) {
                opened = await modeTabs.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
                if (!opened) await page.keyboard.press('Escape');
            }
            if (!opened && attempt < 4) {
                this.log('[STEP 6.0] Waiting for prompt toolbar and generation tabs (attempt ' + (attempt + 1) + '/5)...');
                await this.sleep(2000);
            }
        }
        if (!opened) {
            throw new Error('CLICK_VERIFY_FAILED: generation menu not ready; URL: ' + page.url().split(/[?#]/)[0]);
        }

        // --- 6.1: Switch Video/Image mode ---
        const TYPE_VIDEO = job.TYPE_VIDEO || (isVideoJob ? 'T2V' : 'IMG');
        this.log(`[STEP 6.1] Selecting mode: ${TYPE_VIDEO}...`);
        const modeSelector = coords.modes[TYPE_VIDEO]?.value;
        await mustClickWithVerify(coords.modes, TYPE_VIDEO, modeSelector, `mode:${TYPE_VIDEO}`);
        await this.sleep(150 + Math.random() * 150);

        // Sub-mode for I2V/IN2V
        if (TYPE_VIDEO === 'IN2V' || TYPE_VIDEO === 'I2V') {
            this.log(`[STEP 6.1b] Switching to sub-tab for ${TYPE_VIDEO}...`);
            const subSelector = coords.subModes[TYPE_VIDEO]?.value;
            await mustClickWithVerify(coords.subModes, TYPE_VIDEO, subSelector, `subMode:${TYPE_VIDEO}`);
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
            await countLoc.click({ force: true, humanConfig: { idle_between_actions: false } });
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

        this.log(`[Worker] 🤖 STEP 7/9: Upload Reference Images 🤖`);
        await this.dismissChatPanel(page);
        this.isUploadingReference = true;
        try {
            this.log(`[Worker] Bắt đầu thực thi upload...`);
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
                    const upload = require('./flowUpload');
                    const angular = await page.locator('mat-icon.add-menu-icon:visible').count() > 0;
                    if (angular) {
                        const key = await upload.referenceImageKey(allPaths);
                        const snapshot = await upload.ingredientSnapshot(page);
                        const previous = this._referenceIngredients;
                        // Case 1: Perfect match — same files, same project, same CDN URLs in prompt
                        if (snapshot && previous?.page === page && previous.url === page.url() && previous.key === key && previous.snapshot === snapshot) {
                            this.log('[STEP 7] TOÀN BỘ ẢNH TRÙNG RECORD TRƯỚC VÀ VẪN CÒN TRONG PROMPT. GIỮ ẢNH, CHỈ THAY PROMPT.');
                            return;
                        }
                        // Case 2: Same file content (key matches), same project, but CDN snapshot URLs changed.
                        // This happens when the same images are used across records but Google refreshed the CDN URLs.
                        // Verify ingredients are still present and correct count — if so, skip re-upload to avoid race condition.
                        if (previous?.page === page && previous.url === page.url() && previous.key === key) {
                            const currentIngredientCount = await page.evaluate(() => {
                                const roots = document.querySelectorAll('[data-harumi-ingredient-root]');
                                let count = 0;
                                for (const root of roots) {
                                    count += root.querySelectorAll('flow-image-ingredient-chip').length;
                                }
                                // Fallback: check all visible ingredient chips
                                if (count === 0) {
                                    count = document.querySelectorAll('flow-image-ingredient-chip').length;
                                }
                                return count;
                            }).catch(() => 0);

                            if (currentIngredientCount > 0 && currentIngredientCount === allPaths.length) {
                                this.log(`[STEP 7] ẢNH TRÙNG RECORD TRƯỚC (file hash khớp) và vẫn còn ${currentIngredientCount} ảnh trong prompt. GIỮ ẢNH, CHỈ THAY PROMPT.`);
                                // Update snapshot to current state
                                this._referenceIngredients = { page, url: page.url(), key, snapshot: await upload.ingredientSnapshot(page) };
                                return;
                            }
                            this.log(`[STEP 7] File hash trùng nhưng ingredients trong prompt không khớp (expected=${allPaths.length}, found=${currentIngredientCount}). Cần upload lại.`);
                        }
                        this._referenceIngredients = null;
                        await upload.clearAngularIngredients(page, message => this.log(message));
                        await this.uploadImages(page, allPaths);
                        this._referenceIngredients = { page, url: page.url(), key, snapshot: await upload.ingredientSnapshot(page) };
                        return;
                    }
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
        }
    }

    /**
     * HELPER: Find the submit button coordinates in the DOM.
     * Searches by icon (send/arrow_forward/arrow_upward), aria-label, and position near editor.
     * Returns { x, y, found, method } or { found: false }.
     * Used by Step 8 (initial submit) and Step 9b (retry submits).
     */
    async _findSubmitButtonCoords(page) {
        return await this.safeEvaluate(page, () => {
            const buttons = Array.from(document.querySelectorAll('button'));
            for (const btn of buttons) {
                if (btn.offsetParent === null || btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
                const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                const icons = Array.from(btn.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon.google-symbols'));
                const iconText = icons.map(i => i.textContent.trim()).join(' ');

                // Match send/submit icons
                if (iconText.includes('send') || iconText.includes('arrow_forward') ||
                    iconText.includes('arrow_upward') || iconText.includes('arrow_right_alt')) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true, method: 'icon:' + iconText };
                    }
                }
                if (ariaLabel.includes('send') || ariaLabel.includes('gửi') || ariaLabel.includes('submit') || ariaLabel === 'start generation') {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true, method: 'aria:' + ariaLabel };
                    }
                }
            }
            // Fallback: find a circular/small button near the editor (bottom-right area)
            // Find main editor (skip chat panel's clone)
            const _allEditors = Array.from(document.querySelectorAll('div[data-slate-editor="true"]'));
            const editor = _allEditors.find(ed => {
                const p = ed.closest('div.sc-4e96504a-0, div.sc-1fffc27c-4');
                return !(p && p.querySelector('div[aria-label="Đổi kích thước bảng điều khiển tác nhân"], div[aria-label="Resize agent panel"]'));
            }) || _allEditors[_allEditors.length - 1];
            if (editor) {
                const editorRect = editor.getBoundingClientRect();
                for (const btn of buttons) {
                    if (btn.offsetParent === null || btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
                    const r = btn.getBoundingClientRect();
                    if (r.y >= editorRect.y - 50 && r.y <= editorRect.bottom + 50 && r.x > editorRect.right - 100) {
                        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), found: true, method: 'position-near-editor' };
                    }
                }
            }
            return { found: false };
        }).catch(() => ({ found: false }));
    }

    /**
     * STEP 8: Paste Prompt & Submit
     * Editor is Slate.js: div[data-slate-editor="true"][role="textbox"] (NOT a textarea)
     * Placeholder: "Bạn muốn tạo gì?"
     */
    async pastePromptAndSubmit(page, job) {
        this.log('[Worker] [step8_started] 🤖 STEP 8/9: Paste Prompt & Submit 🤖');
        await this.dismissChatPanel(page);
        const cleanPrompt = String(job.PROMPT || '').normalize('NFC');

        // Check if there is already a tile rendering or queued with the same prompt (FAST mode recovery)
        const duplicateTileId = await page.evaluate((targetPrompt) => {
            const cleanText = (txt) => (txt || '').replace(/\uFEFF/g, '').trim().toLowerCase();
            const target = cleanText(targetPrompt);
            if (!target) return null;

            const isElementVisible = (el) => {
                if (!el) return false;
                let current = el;
                while (current && current !== document.body) {
                    const style = window.getComputedStyle(current);
                    if (style.display === 'none' || style.visibility === 'hidden') return false;
                    const rect = current.getBoundingClientRect();
                    if (style.overflow === 'hidden' && rect.width <= 2 && rect.height <= 2) return false;
                    current = current.parentElement;
                }
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            };

            const tiles = Array.from(document.querySelectorAll('[data-tile-id]'));
            for (const tile of tiles) {
                if (!isElementVisible(tile)) continue;
                const tileId = tile.getAttribute('data-tile-id');
                const tileText = cleanText(tile.textContent || '');

                // Check if tile matches prompt (handles truncation with '...')
                const truncatedTarget = target.substring(0, 40);
                const matchesPrompt = tileText.includes(truncatedTarget) || 
                    (tileText.length > 10 && target.includes(tileText.replace(/\.\.\./g, '').trim()));

                if (matchesPrompt) {
                    const hasMedia = tile.querySelector('img, video') !== null;
                    const hasError = tileText.includes('không thành công') || tileText.includes('policy') || 
                        tileText.includes('chính sách') || tileText.includes('vi phạm');
                    
                    const isGenerating = tileText.match(/\d+%/) || tileText.includes('đang tạo') || 
                        tileText.includes('generating') || tileText.includes('queued') || 
                        tileText.includes('đang chờ') || tileText.includes('in queue') ||
                        (!hasMedia && !hasError);

                    if (isGenerating) {
                        return tileId;
                    }
                }
            }
            return null;
        }, cleanPrompt).catch(() => null);

        if (duplicateTileId) {
            this.log(`[STEP 8] ⚠️ Found duplicate tile already generating/queued: ${duplicateTileId}. Skipping prompt paste and submit click.`);
            if (this._existingTileIds) {
                this._existingTileIds = this._existingTileIds.filter(id => id !== duplicateTileId);
            }
            return;
        }

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

        this.log('[STEP 8] Waiting for a visible, editable prompt composer...');
        const editorKind = await require('./flowUpload').waitForPromptEditor(page);
        const angularPrompt = editorKind === 'angular';
        this.log(`[STEP 8] Prompt composer ready: ${editorKind}`);
        if (job.TYPE_VIDEO === 'T2V' && angularPrompt) {
            this._referenceIngredients = null;
            await require('./flowUpload').clearAngularIngredients(page, message => this.log(message));
        }
        if (expectedCount > 0) {
            const actualCount = angularPrompt
                ? await require('./flowUpload').countAngularPromptMedia(page)
                : await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('button[data-card-open][data-state]')).filter(card => {
                    const img = card.querySelector('img[src*="media.getMediaUrlRedirect"]');
                    if (!img) return false;
                    const hasCancelIcon = Array.from(card.querySelectorAll('i, span, div, button')).some(el => {
                        const txt = (el.textContent || '').trim().toLowerCase();
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

        if (angularPrompt) {
            await require('./flowUpload').pasteAngularPrompt(page, cleanPrompt, msg => this.log(msg));
            this.log('[STEP 8] Angular prompt pasted via insertText and text verified.');
        } else {
            // Slate.js editor — contenteditable div, NOT textarea
            const editorSelector = 'div[data-slate-editor="true"][role="textbox"]';

            await page.waitForSelector(editorSelector, { state: 'visible', timeout: 10000 });

            // Click the MAIN editor specifically (skip chat panel's identical clone)
            this.log('[STEP 8] Clicking main Slate editor (skipping chat panel if present)...');
            const mainEditorCoords = await page.evaluate(() => {
                const editors = Array.from(document.querySelectorAll('div[data-slate-editor="true"][role="textbox"]'));
                const main = editors.find(ed => {
                    const panel = ed.closest('div.sc-4e96504a-0, div.sc-1fffc27c-4');
                    if (panel && panel.querySelector(
                        'div[aria-label="Đổi kích thước bảng điều khiển tác nhân"], ' +
                        'div[aria-label="Resize agent panel"]'
                    )) return false;
                    return true;
                }) || editors[editors.length - 1];
                if (!main) return null;
                const r = main.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) return null;
                main.focus();
                return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
            }).catch(() => null);
            if (mainEditorCoords) {
                await this.humanClick(page, mainEditorCoords.x, mainEditorCoords.y, { humanConfig: { idle_between_actions: false } });
            } else {
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
                    const text = (el.textContent || '').replace(/\uFEFF/g, '').trim();
                    return text.length > 0;
                }, editorSelector);

                if (hasText) {
                    entrySuccess = true;
                    this.log('[STEP 8] ✓ Prompt entered and verified successfully.');
                } else {
                    this.log('[STEP 8] Prompt paste not verified. Retrying full-text paste...');
                }
            } catch (err) {
                this.log(`[STEP 8] ⚠️ Prompt entry attempt failed: ${err.message}`);
            }

            // Retry the entire prompt without slow per-character typing.
            if (!entrySuccess) {
                try {
                    await page.focus(editorSelector);
                    await page.keyboard.press('Control+a');
                    await page.keyboard.press('Backspace');
                    await page.keyboard.insertText(cleanPrompt);
                    this.log('[STEP 8] Full-text paste retry completed.');
                } catch (fallbackErr) {
                    this.log(`[STEP 8] ❌ Prompt entry fallback failed: ${fallbackErr.message}`);
                    // Last resort: try force fill
                    await page.fill(editorSelector, cleanPrompt).catch(() => { });
                }
            }
            await this.sleep(400 + Math.random() * 300);

        }

        // Brief review pause
        this.log('[STEP 8] Reviewing prompt...');
        await this.sleep(500 + Math.random() * 700);

        // Submit by clicking the submit button (arrow icon → next to editor)
        // Enter key does NOT submit in Slate.js - it only creates a newline
        this.log('[STEP 8] Clicking submit button...');
        const submitClicked = angularPrompt ? { found: false } : await this._findSubmitButtonCoords(page);

        if (angularPrompt) await require('./flowGeneration').trackAngularTiles(page);

        // --- Snapshot existing tiles BEFORE submit ---
        this._existingTileIds = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('[data-tile-id]'))
                .map(el => el.getAttribute('data-tile-id'));
        });
        this.log(`[STEP 8] Snapshot taken: ${this._existingTileIds.length} existing tiles.`);

        if (angularPrompt) {
            this.log('[STEP 8] Waiting for Start generation to become enabled...');
            await require('./flowGeneration').clickAngularGenerate(page);
            this.log('[STEP 8] Start generation clicked; awaiting generation confirmation in STEP 9.');
        } else if (submitClicked.found) {
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
        if (!page) {
            this.log('[STEP 9] ⚠️ Cannot wait and download because page is null.');
            throw new Error('BROWSER_PAGE_CLOSED: page is null');
        }
        if (this.isKilled || (this.automationService && !this.automationService.isRunning)) {
            this.log('[STEP 9] ⚠️ Job aborted: Service stopped or worker killed.');
            throw new Error('JOB_ABORTED: Service stopped or worker killed');
        }

        this.log('[Worker] 🤖 STEP 9/9: Wait & Download 🤖');

        let jobSuccess = false;
        let downloadedFile = null;
        let hasError = false;
        let currentErrorReason = '';
        let maxWaitSeconds = job.TYPE_VIDEO === 'IMG' ? 70 : 150;
        let targetMediaCoords = null;
        let completedTileId = null;
        let loopCompleted = false;

        // Khai báo trước try block để catch luôn truy cập được
        let cancelDownload = () => {};

        // --- Console/Response error trackers (Pre-declared for 9a immediate errors) ---
        let hasZodOr429Error = false;
        let zodOr429Reason = '';
        const consoleHandler = (msg) => {
            const text = msg.text() || '';
            if (text.includes('ZodError') || text.includes('429')) {
                hasZodOr429Error = true;
                zodOr429Reason = text.includes('ZodError') ? 'ZodError' : '429_Error';
            }
        };
        // Flag 403/429/ZodError only from API generation, not from static/analytics/favicon
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

        // --- 9a: Submit confirmation (15s) ---
        this.log('[STEP 9a] Waiting for submit confirmation (Toast/%/new tile)...');
        let submitConfirmed = false;
        for (let check = 0; check < 10; check++) {
            // Check for immediate errors from console/network (ZodError, 403, 429)
            if (hasZodOr429Error) {
                this.log(`[STEP 9a] Immediate API/Console error detected: ${zodOr429Reason}. Bypassing 15s wait.`);
                hasError = true;
                currentErrorReason = zodOr429Reason;
                break;
            }

            // Check for page-level or tile-level specific keyword errors in DOM to bypass 15s wait
            try {
                const immediateError = await this.safeEvaluate(page, (existingIds) => {
                    const isVisible = (el) => el.offsetParent !== null;
                    const isElementVisible = (el) => {
                        if (!el) return false;
                        let current = el;
                        while (current && current !== document.body) {
                            const style = window.getComputedStyle(current);
                            if (style.display === 'none' || style.visibility === 'hidden') return false;
                            const rect = current.getBoundingClientRect();
                            if (style.overflow === 'hidden' && rect.width <= 2 && rect.height <= 2) return false;
                            current = current.parentElement;
                        }
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    };

                    const getVisibleText = (el) => {
                        if (!el) return '';
                        if (el.nodeType === Node.ELEMENT_NODE && !isElementVisible(el)) return '';
                        if (el.nodeType === Node.TEXT_NODE) return el.textContent || '';
                        if (el.childNodes && el.childNodes.length > 0) {
                            let text = '';
                            for (const child of el.childNodes) {
                                if (child.nodeType === Node.TEXT_NODE) {
                                    text += child.textContent || '';
                                } else if (child.nodeType === Node.ELEMENT_NODE) {
                                    text += ' ' + getVisibleText(child);
                                }
                            }
                            return text;
                        }
                        return el.textContent || '';
                    };

                    // NOTE: Removed global body.textContent scan — it caused massive false positives
                    // by matching stale text from old tiles' error messages still in the DOM.
                    // The scoped checks below (page alerts, title divs, newest tile) are sufficient.

                    // 1. Check page alerts
                    const pageAlerts = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"]'));
                    for (const alert of pageAlerts) {
                        if (!isVisible(alert)) continue;
                        const t = (alert.textContent || '').toLowerCase();
                        if (t.includes('nhà cung cấp nội dung bên thứ ba') || t.includes('nội dung bên thứ ba') ||
                            t.includes('third-party content') || t.includes('third party content') || t.includes('content provider')) {
                            return { isError: true, reason: 'third_party_content_violation', text: 'page_alert: ' + t.substring(0, 300) };
                        }
                        if (t.includes('chính sách') || t.includes('vi phạm') || t.includes('policy') ||
                            t.includes('vui lòng thử một câu lệnh khác') || t.includes('vui lòng thử lại một câu lệnh khác') || t.includes('vui lòng thử lại 1 câu lệnh khác') ||
                            t.includes('try a different prompt') || t.includes('try another prompt')) {
                            return { isError: true, reason: 'prompt_policy_violation', text: 'page_alert: ' + t.substring(0, 300) };
                        }
                        // Audio error in page alert: catch as tile_generation_error
                        {
                            const hasAudioErr = t.includes('âm thanh') || t.includes('audio');
                            const hasPromptSuggestion = t.includes('vui lòng thử') || t.includes('câu lệnh khác') || t.includes('try another') || t.includes('try a different') || t.includes('prompt');
                            if (hasAudioErr && hasPromptSuggestion) {
                                return { isError: true, reason: 'tile_generation_error', text: 'page_alert_audio_failure: ' + t.substring(0, 300) };
                            }
                        }
                        // Generic error: "Rất tiếc, đã xảy ra lỗi!"
                        if ((t.includes('rất tiếc') || t.includes('sorry')) && (t.includes('đã xảy ra lỗi') || t.includes('an error'))) {
                            return { isError: true, reason: 'tile_generation_error', text: 'page_alert_generic_error: ' + t.substring(0, 300) };
                        }
                        if (t.includes('mất nhiều thời gian') || t.includes('dự kiến') || t.includes('giây lát')) {
                            return { isError: true, reason: 'tile_generation_error', text: 'page_alert: ' + t.substring(0, 300) };
                        }
                        if (t.includes('dùng hết hạn mức') || t.includes('hạn mức về số lượt tạo') || t.includes('hạn mức') || t.includes('giới hạn') || t.includes('limit')) {
                            return { isError: true, reason: 'model_limit_exceeded', text: 'page_alert: ' + t.substring(0, 300) };
                        }
                        if (t.includes('unusual activity') || t.includes('hoạt động bất thường')) {
                            return { isError: true, reason: 'unusual_activity', text: 'page_alert: ' + t.substring(0, 300) };
                        }
                    }

                    // 2. Check title divs for custom alerts
                    const titleDivs = Array.from(document.querySelectorAll('div, span'))
                        .filter(el => {
                            const text = (el.textContent || '').trim().toLowerCase();
                            return text === 'không thành công' && isElementVisible(el);
                        });
                    for (const el of titleDivs) {
                        let parent = el.parentElement;
                        for (let depth = 0; depth < 3 && parent; depth++) {
                            const text = (parent.textContent || '').toLowerCase();
                            if (text.includes('nhà cung cấp nội dung bên thứ ba') || text.includes('nội dung bên thứ ba') ||
                                text.includes('third-party content') || text.includes('third party content') || text.includes('content provider')) {
                                return { isError: true, reason: 'third_party_content_violation', text: 'alert_banner: ' + text.substring(0, 300) };
                            }
                            if (text.includes('chính sách') || text.includes('vi phạm') || text.includes('policy') ||
                                text.includes('vui lòng thử một câu lệnh khác') || text.includes('vui lòng thử lại một câu lệnh khác') || text.includes('vui lòng thử lại 1 câu lệnh khác') ||
                                text.includes('try a different prompt') || text.includes('try another prompt')) {
                                return { isError: true, reason: 'prompt_policy_violation', text: 'alert_banner: ' + text.substring(0, 300) };
                            }
                            // Audio error in "không thành công" banner: catch as tile_generation_error
                            {
                                const hasAudioErr = text.includes('âm thanh') || text.includes('audio');
                                const hasPromptSuggestion = text.includes('vui lòng thử') || text.includes('câu lệnh khác') || text.includes('try another') || text.includes('try a different') || text.includes('prompt');
                                if (hasAudioErr && hasPromptSuggestion) {
                                    return { isError: true, reason: 'tile_generation_error', text: 'alert_banner_audio_failure: ' + text.substring(0, 300) };
                                }
                            }
                            // Generic error: "Rất tiếc, đã xảy ra lỗi!"
                            if ((text.includes('rất tiếc') || text.includes('sorry')) && (text.includes('đã xảy ra lỗi') || text.includes('an error'))) {
                                return { isError: true, reason: 'tile_generation_error', text: 'alert_banner_generic_error: ' + text.substring(0, 300) };
                            }
                            if (text.includes('mất nhiều thời gian') || text.includes('dự kiến') || text.includes('giây lát')) {
                                return { isError: true, reason: 'tile_generation_error', text: 'alert_banner: ' + text.substring(0, 300) };
                            }
                            if (text.includes('hạn mức') || text.includes('limit') || text.includes('giới hạn')) {
                                return { isError: true, reason: 'model_limit_exceeded', text: 'alert_banner: ' + text.substring(0, 300) };
                            }
                            if (text.includes('hoạt động bất thường') || text.includes('unusual activity')) {
                                return { isError: true, reason: 'unusual_activity', text: 'alert_banner: ' + text.substring(0, 300) };
                            }
                        }
                    }

                    // 3. Check newest tile text for specific errors
                    const allTiles = Array.from(document.querySelectorAll('[data-tile-id]'));
                    const newTiles = allTiles.filter(t => !existingIds.includes(t.getAttribute('data-tile-id')));
                    if (newTiles.length > 0) {
                        const newest = newTiles[0];
                        const text = (getVisibleText(newest) || '').toLowerCase();
                        if (text.includes('nhà cung cấp nội dung bên thứ ba') || text.includes('nội dung bên thứ ba') ||
                            text.includes('third-party content') || text.includes('third party content') || text.includes('content provider')) {
                            return { isError: true, reason: 'third_party_content_violation', text: text.substring(0, 300) };
                        }
                        if (text.includes('chính sách') || text.includes('vi phạm') || text.includes('policy') ||
                            text.includes('vui lòng thử một câu lệnh khác') || text.includes('vui lòng thử lại một câu lệnh khác') || text.includes('vui lòng thử lại 1 câu lệnh khác') ||
                            text.includes('try a different prompt') || text.includes('try another prompt')) {
                            return { isError: true, reason: 'prompt_policy_violation', text: text.substring(0, 300) };
                        }
                        // Generic error: "Rất tiếc, đã xảy ra lỗi!"
                        if ((text.includes('rất tiếc') || text.includes('sorry')) && (text.includes('đã xảy ra lỗi') || text.includes('an error'))) {
                            return { isError: true, reason: 'tile_generation_error', text: 'generic_error: ' + text.substring(0, 300) };
                        }
                        // Audio full failure
                        {
                            const hasAudioErr = text.includes('âm thanh') || text.includes('audio');
                            const hasPromptSuggestion = text.includes('vui lòng thử') || text.includes('câu lệnh khác') || text.includes('try another') || text.includes('try a different') || text.includes('prompt');
                            if (hasAudioErr && hasPromptSuggestion) {
                                return { isError: true, reason: 'tile_generation_error', text: 'audio_full_failure: ' + text.substring(0, 300) };
                            }
                        }
                        if (text.includes('mất nhiều thời gian') || text.includes('dự kiến') || text.includes('giây lát')) {
                            return { isError: true, reason: 'tile_generation_error', text: text.substring(0, 300) };
                        }
                        if (text.includes('dùng hết hạn mức') || text.includes('hạn mức về số lượt tạo') || text.includes('giới hạn')) {
                            return { isError: true, reason: 'model_limit_exceeded', text: text.substring(0, 300) };
                        }
                        if (text.includes('unusual activity') || text.includes('hoạt động bất thường')) {
                            return { isError: true, reason: 'unusual_activity', text: text.substring(0, 300) };
                        }
                    }

                    return null;
                }, this._existingTileIds || []);

                if (immediateError) {
                    this.log(`[STEP 9a] Specific error keyword detected: ${immediateError.reason}. Bypassing 15s wait.`);
                    hasError = true;
                    currentErrorReason = `${immediateError.reason} (matched text: "${immediateError.text || ''}")`;
                    break;
                }
            } catch (e) {
                this.log(`[STEP 9a] Error scan failed: ${e.message}`);
            }

            try {
                submitConfirmed = await this.safeEvaluate(page, (existingIds) => {
                    const isVisible = (el) => el.offsetParent !== null;
                    const alerts = Array.from(document.querySelectorAll('[role="alert"], [class*="snackbar"], snack-bar, .msg, .toast'));
                    for (let a of alerts) {
                        if (!isVisible(a)) continue;
                        const t = (a.textContent || '').toLowerCase();
                        if (t.includes('đang tạo') || t.includes('creating') || t.includes('queued') || t.includes('working')) return true;
                    }
                    const texts = Array.from(document.querySelectorAll('span, div, p'));
                    const hasTextConfirmation = texts.some(el => {
                        if (!isVisible(el)) return false;
                        const r = el.getBoundingClientRect();
                        if (r.y > window.innerHeight - 250) return false; // Skip editor area (upload %)
                        const t = el.textContent.trim();
                        if (t.includes('Đang tạo') || t.includes('Generating')) return true;
                        return t.endsWith('%') && t.length > 1 && t.length <= 5 && !isNaN(parseInt(t));
                    });
                    if (hasTextConfirmation) return true;

                    // Confirm via presence of a new tile (since a new tile is created after submit)
                    const allTiles = Array.from(document.querySelectorAll('[data-tile-id]'));
                    const newTiles = allTiles.filter(t => !existingIds.includes(t.getAttribute('data-tile-id')));
                    if (newTiles.length > 0) return true;

                    return false;
                }, this._existingTileIds || []);
                if (submitConfirmed) {
                    this.log('[STEP 9a] ✓ Submit confirmed by system.');
                    break;
                }
            } catch (e) {
                this.log('[STEP 9a] DOM temporarily unavailable, retrying...');
            }
            await this.sleep(1500);
        }
        if (!submitConfirmed && !hasError) {
            this.log('[STEP 9a] ⚠️ No confirmation after 15s. Continuing with risk...');
        }

        // --- 9b: Render progress tracking ---
        this.log('[STEP 9b] Starting render progress tracking...');

        // downloadPromise will be registered in 9f, just before download click

        this.hasSeenGenerating = false;
        this.scrolledToTopDuringRender = false;
        this._coordsCapturedAt75 = false;
        this._tileSubmitRetryCount = 0;
        this._tileRetryMax = 0;
        let waitTime = 0;
        const downloadInterval = setInterval(() => {
            if (this.automationService?.isPaused) {
                return;
            }
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
                await require('./flowGeneration').assertGenerationCredits(page);
                if (waitTime >= maxWaitSeconds) {
                    this.log(`[STEP 9b] ⚠️ Reached max wait time limit of ${maxWaitSeconds}s. Stopping wait loop.`);
                    break;
                }
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
                const errorCheck = await this.safeEvaluate(page, ([existingIds, elapsedSeconds, isImageJob]) => {
                    // Angular render results are handled by the tracked card below.
                    // Page-wide text may belong to older failed renders or the prompt.
                    if (window.__harumiTileTracker?.read && !isImageJob) {
                        return { isError: false, reason: 'tracked_angular_tile' };
                    }
                    const isVisible = (el) => el.offsetParent !== null;
                    const isElementVisible = (el) => {
                        if (!el) return false;
                        let current = el;
                        while (current && current !== document.body) {
                            const style = window.getComputedStyle(current);
                            if (style.display === 'none' || style.visibility === 'hidden') {
                                return false;
                            }
                            const rect = current.getBoundingClientRect();
                            if (style.overflow === 'hidden' && rect.width <= 2 && rect.height <= 2) {
                                return false;
                            }
                            current = current.parentElement;
                        }
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    };

                    const getVisibleText = (el) => {
                        if (!el) return '';
                        if (el.nodeType === Node.ELEMENT_NODE && !isElementVisible(el)) return '';
                        
                        if (el.nodeType === Node.TEXT_NODE) {
                            return el.textContent || '';
                        }
                        
                        if (el.childNodes && el.childNodes.length > 0) {
                            let text = '';
                            for (const child of el.childNodes) {
                                if (child.nodeType === Node.TEXT_NODE) {
                                    text += child.textContent || '';
                                } else if (child.nodeType === Node.ELEMENT_NODE) {
                                    text += ' ' + getVisibleText(child);
                                }
                            }
                            return text;
                        }
                        
                        return el.textContent || '';
                    };

                    const allTiles = Array.from(document.querySelectorAll('[data-tile-id]'));
                    const newTiles = allTiles.filter(t => !existingIds.includes(t.getAttribute('data-tile-id')));
                    if (newTiles.length === 0) return { isError: false, reason: 'no_new_tile' };

                    // Quick scan: if ANY tile has %/generating/queue/blank → veto ALL errors
                    for (const tile of newTiles) {
                        const t = (getVisibleText(tile) || '').toLowerCase();
                        const hasMedia = tile.querySelector('img, video') !== null;
                        const hasAudioErr = t.includes('âm thanh') || t.includes('audio');
                        const hasPromptSuggestion = t.includes('vui lòng thử') || t.includes('câu lệnh khác') || t.includes('try another') || t.includes('try a different') || t.includes('prompt');
                        const isAudioOnlyError = hasAudioErr && hasPromptSuggestion;
                        // Audio error WITHOUT media = real 3-button error card (no video generated)
                        // Audio error WITH media = audio-only failure (video OK, just no audio) → dismiss
                        const isAudioFullFailure = isAudioOnlyError && !hasMedia;
                        const isGenericError = (t.includes('rất tiếc') || t.includes('sorry')) && (t.includes('đã xảy ra lỗi') || t.includes('an error'));
                        
                        const isPolicyViolation = t.includes('chính sách') || t.includes('vi phạm') || t.includes('policy') ||
                            t.includes('vui lòng thử một câu lệnh khác') || t.includes('vui lòng thử lại một câu lệnh khác') || t.includes('vui lòng thử lại 1 câu lệnh khác') ||
                            t.includes('try a different prompt') || t.includes('try another prompt');

                        const isThirdPartyViolation = t.includes('nhà cung cấp nội dung bên thứ ba') || t.includes('nội dung bên thứ ba') ||
                            t.includes('third-party content') || t.includes('third party content') || t.includes('content provider');

                        const hasError = isAudioFullFailure || isGenericError || isPolicyViolation || isThirdPartyViolation ||
                            (t.includes('unusual activity') || t.includes('hoạt động bất thường') ||
                            t.includes('cancelled') || t.includes('not charged') || t.includes('đã huỷ') || t.includes('không bị trừ'));

                        // Detect 3-button error cards: "không thành công" with no media = definite error
                        if (!hasMedia && t.includes('không thành công') && hasError) {
                            if (isPolicyViolation) {
                                return { isError: true, reason: 'prompt_policy_violation', text: 'alert_card: ' + t.substring(0, 300) };
                            }
                            if (isThirdPartyViolation) {
                                return { isError: true, reason: 'third_party_content_violation', text: 'alert_card: ' + t.substring(0, 300) };
                            }
                            if (isAudioFullFailure) {
                                return { isError: true, reason: 'tile_generation_error', text: 'audio_full_failure: ' + t.substring(0, 300) };
                            }
                            if (isGenericError) {
                                return { isError: true, reason: 'tile_generation_error', text: 'generic_error: ' + t.substring(0, 300) };
                            }
                        }

                        // Direct check on the tile text even if it doesn't have "không thành công" title wrapper
                        if (isPolicyViolation) {
                            return { isError: true, reason: 'prompt_policy_violation', text: t.substring(0, 300) };
                        }
                        if (isThirdPartyViolation) {
                            return { isError: true, reason: 'third_party_content_violation', text: t.substring(0, 300) };
                        }

                        const isGenerating = t.match(/\d+%/) || t.includes('đang tạo') || t.includes('generating') ||
                            t.includes('queued') || t.includes('đang chờ') || t.includes('in queue') ||
                            (!hasMedia && !hasError); // Veto if it's a blank card!

                        if (isGenerating) {
                            return { isError: false, reason: 'is_generating_veto' };
                        }
                        // Check completed: tile has img/video and NO error text
                        if (hasMedia && !hasError) {
                            return { isError: false, reason: 'is_completed_veto' };
                        }
                    }

                    // Page-level alerts and banners (checking role alerts and custom styled banners)
                    const getPageAlert = () => {
                        const pageAlerts = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"]'));
                        for (const alert of pageAlerts) {
                            if (!isVisible(alert)) continue;
                            const t = (alert.textContent || '').toLowerCase();
                            // Audio error in page alert: catch as tile_generation_error (no video generated)
                            const hasAudioErr = t.includes('âm thanh') || t.includes('audio');
                            const hasPromptSuggestion = t.includes('vui lòng thử') || t.includes('câu lệnh khác') || t.includes('try another') || t.includes('try a different') || t.includes('prompt');
                            if (hasAudioErr && hasPromptSuggestion) {
                                return { isError: true, reason: 'tile_generation_error', text: 'page_alert_audio_failure: ' + t.substring(0, 300) };
                            }
                            // Generic error: "Rất tiếc, đã xảy ra lỗi!"
                            const isGenericError = (t.includes('rất tiếc') || t.includes('sorry')) && (t.includes('đã xảy ra lỗi') || t.includes('an error'));
                            if (isGenericError) {
                                return { isError: true, reason: 'tile_generation_error', text: 'page_alert_generic_error: ' + t.substring(0, 300) };
                            }
                            if (t.includes('nhà cung cấp nội dung bên thứ ba') || t.includes('nội dung bên thứ ba') ||
                                t.includes('third-party content') || t.includes('third party content') || t.includes('content provider')) {
                                return { isError: true, reason: 'third_party_content_violation', text: 'page_alert: ' + t.substring(0, 300) };
                            }
                            if (t.includes('chính sách') || t.includes('vi phạm') || t.includes('policy') ||
                                t.includes('vui lòng thử một câu lệnh khác') || t.includes('vui lòng thử lại một câu lệnh khác') || t.includes('vui lòng thử lại 1 câu lệnh khác') ||
                                t.includes('try a different prompt') || t.includes('try another prompt')) {
                                return { isError: true, reason: 'prompt_policy_violation', text: 'page_alert: ' + t.substring(0, 300) };
                            }
                            if (t.includes('mất nhiều thời gian') || t.includes('dự kiến') || t.includes('giây lát')) {
                                return { isError: true, reason: 'tile_generation_error', text: 'page_alert: ' + t.substring(0, 300) };
                            }
                            if (t.includes('dùng hết hạn mức') || t.includes('hạn mức về số lượt tạo') || t.includes('hạn mức') || t.includes('giới hạn') || t.includes('limit')) {
                                return { isError: true, reason: 'model_limit_exceeded', text: 'page_alert: ' + t.substring(0, 300) };
                            }
                            if (t.includes('unusual activity') || t.includes('hoạt động bất thường')) {
                                return { isError: true, reason: 'unusual_activity', text: 'page_alert: ' + t.substring(0, 300) };
                            }
                        }

                        // Search for the specific styled-component alert divs that don't have role="alert"
                        const titleDivs = Array.from(document.querySelectorAll('div, span'))
                            .filter(el => {
                                const text = (el.textContent || '').trim().toLowerCase();
                                return text === 'không thành công' && isElementVisible(el);
                            });
                        for (const el of titleDivs) {
                            let parent = el.parentElement;
                            for (let depth = 0; depth < 3 && parent; depth++) {
                                const text = (parent.textContent || '').toLowerCase();
                                // Audio error in "không thành công" banner: catch as tile_generation_error
                                const hasAudioErr = text.includes('âm thanh') || text.includes('audio');
                                const hasPromptSuggestion = text.includes('vui lòng thử') || text.includes('câu lệnh khác') || text.includes('try another') || text.includes('try a different') || text.includes('prompt');
                                if (hasAudioErr && hasPromptSuggestion) {
                                    return { isError: true, reason: 'tile_generation_error', text: 'alert_banner_audio_failure: ' + text.substring(0, 300) };
                                }
                                // Generic error: "Rất tiếc, đã xảy ra lỗi!"
                                const isGenericError = (text.includes('rất tiếc') || text.includes('sorry')) && (text.includes('đã xảy ra lỗi') || text.includes('an error'));
                                if (isGenericError) {
                                    return { isError: true, reason: 'tile_generation_error', text: 'alert_banner_generic_error: ' + text.substring(0, 300) };
                                }
                                if (text.includes('nhà cung cấp nội dung bên thứ ba') || text.includes('nội dung bên thứ ba') ||
                                    text.includes('third-party content') || text.includes('third party content') || text.includes('content provider')) {
                                    return { isError: true, reason: 'third_party_content_violation', text: 'alert_banner: ' + text.substring(0, 300) };
                                }
                                if (text.includes('chính sách') || text.includes('vi phạm') || text.includes('policy') ||
                                    text.includes('vui lòng thử một câu lệnh khác') || text.includes('vui lòng thử lại một câu lệnh khác') || text.includes('vui lòng thử lại 1 câu lệnh khác') ||
                                    text.includes('try a different prompt') || text.includes('try another prompt')) {
                                    return { isError: true, reason: 'prompt_policy_violation', text: 'alert_banner: ' + text.substring(0, 300) };
                                }
                                if (text.includes('mất nhiều thời gian') || text.includes('dự kiến') || text.includes('giây lát')) {
                                    return { isError: true, reason: 'tile_generation_error', text: 'alert_banner: ' + text.substring(0, 300) };
                                }
                                if (text.includes('hạn mức') || text.includes('limit') || text.includes('giới hạn')) {
                                    return { isError: true, reason: 'model_limit_exceeded', text: 'alert_banner: ' + text.substring(0, 300) };
                                }
                                if (text.includes('hoạt động bất thường') || text.includes('unusual activity')) {
                                    return { isError: true, reason: 'unusual_activity', text: 'alert_banner: ' + text.substring(0, 300) };
                                }
                            }
                        }
                        return null;
                    };

                    const pageAlert = getPageAlert();
                    if (pageAlert) return pageAlert;

                    // No generating/completed tile → check NEWEST tile for error
                    const newest = newTiles[0];
                    const text = (getVisibleText(newest) || '').toLowerCase();

                    if (text.includes('chính sách') || text.includes('vi phạm') || text.includes('policy') ||
                        text.includes('vui lòng thử một câu lệnh khác') || text.includes('vui lòng thử lại một câu lệnh khác') || text.includes('vui lòng thử lại 1 câu lệnh khác') ||
                        text.includes('try a different prompt') || text.includes('try another prompt')) {
                        return { isError: true, reason: 'prompt_policy_violation', text: text.substring(0, 300) };
                    }
                    if (text.includes('mất nhiều thời gian') || text.includes('dự kiến') || text.includes('giây lát')) {
                        return { isError: true, reason: 'tile_generation_error', text: text.substring(0, 300) };
                    }
                    // Generic error: "Rất tiếc, đã xảy ra lỗi!" / "Sorry, an error occurred!"
                    if ((text.includes('rất tiếc') || text.includes('sorry')) && (text.includes('đã xảy ra lỗi') || text.includes('an error'))) {
                        return { isError: true, reason: 'tile_generation_error', text: 'generic_error: ' + text.substring(0, 300) };
                    }
                    // Audio full failure (no media, audio error with prompt suggestion)
                    {
                        const hasAudioErr = text.includes('âm thanh') || text.includes('audio');
                        const hasPromptSuggestion = text.includes('vui lòng thử') || text.includes('câu lệnh khác') || text.includes('try another') || text.includes('try a different');
                        if (hasAudioErr && hasPromptSuggestion) {
                            return { isError: true, reason: 'tile_generation_error', text: 'audio_full_failure: ' + text.substring(0, 300) };
                        }
                    }
                    if (text.includes('dùng hết hạn mức') || text.includes('hạn mức về số lượt tạo') || text.includes('giới hạn')) {
                        return { isError: true, reason: 'model_limit_exceeded', text: text.substring(0, 300) };
                    }
                    if (text.includes('unusual activity') || text.includes('hoạt động bất thường')) {
                        return { isError: true, reason: 'unusual_activity', text: text.substring(0, 300) };
                    }
                    
                    // Only check for queue cancellation errors after 15 seconds
                    if (elapsedSeconds >= 15) {
                        if (text.includes('was cancelled') || text.includes('cancelled') || text.includes('not charged') ||
                            text.includes('đã huỷ') || text.includes('không bị trừ')) {
                            return { isError: true, reason: 'queue_cancelled', text: text.substring(0, 300) };
                        }
                    }
                    
                    if (text === 'queued' || text.includes('in queue') || text.includes('đang chờ')) {
                        return { isError: true, reason: 'is_queued', text: text.substring(0, 300) };
                    }

                    return { isError: false, reason: 'no_error_indicators' };
                }, [existingTileIds, waitTime, job.TYPE_VIDEO === 'IMG']);

                // Snapshot-and-consume: capture current 403/429 flag, then reset immediately
                // This ensures we only react to responses from THIS poll interval,
                // not stale 403s from previous submit attempts
                const currentZodOr429 = hasZodOr429Error;
                const currentZodOr429Reason = zodOr429Reason;
                hasZodOr429Error = false;
                zodOr429Reason = '';

                if (errorCheck.isError) {
                    currentErrorReason = `${errorCheck.reason} (matched text: "${errorCheck.text || ''}")`;
                    hasError = true;
                } else if (currentZodOr429) {
                    currentErrorReason = currentZodOr429Reason;
                    hasError = true;
                }

                // --- 3-button error card detection (REMOVED) ---
                // This block was globally scanning the DOM, ignoring tile-based isolation, 
                // and causing false positives from previous jobs' error cards.

                // --- unusual_activity / 403 retry: submit lại 3 lần trước khi escalate ---
                if (hasError && (currentErrorReason === 'unusual_activity' || currentErrorReason.startsWith('unusual_activity') ||
                    currentErrorReason === '403_Forbidden' || currentErrorReason.startsWith('403_Forbidden'))) {
                    this._uaSubmitRetryCount = (this._uaSubmitRetryCount || 0) + 1;
                    if (!this._uaMaxRetries) this._uaMaxRetries = 2 + Math.floor(Math.random() * 3); // 2-4 lần


                    if (this._uaSubmitRetryCount <= this._uaMaxRetries) {
                        this.log(`[STEP 9b] ⚠️ ${currentErrorReason} detected. Retry submit ${this._uaSubmitRetryCount}/${this._uaMaxRetries} in a moment (prompt & images still intact)...`);
                        hasError = false;
                        currentErrorReason = '';
                        const retryWait = 3000 + Math.floor(Math.random() * 4000); // 3-7s
                        this.log(`[STEP 9b] Waiting ${Math.round(retryWait / 1000)}s before retry...`);
                        await this.sleep(retryWait);

                        // Re-click submit button (reuse submit finder from step 8)
                        const retrySubmit = await this._findSubmitButtonCoords(page);

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

                    // Tất cả retry đều fail → chờ 60s → Xóa localStorage → F5 reload
                    this.log(`[STEP 9b] ❌ Unusual activity persists after ${this._uaMaxRetries} submit retries. Cooling down 60s before clearing storage...`);
                    await this.sleep(60000);

                    // Clear cookies (whitelist mode — keep auth, purge everything else)
                    try {
                        if (typeof this.clearGoogleLabsCookies === 'function') {
                            await this.clearGoogleLabsCookies(page);
                        }
                    } catch (e) { this.log(`[STEP 9b] Cookie clear warning: ${e.message}`); }

                    this.log('[STEP 9b] ✓ Cookies + localStorage + sessionStorage cleared via clearGoogleLabsCookies.');

                    // F5 reload
                    try {
                        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                        this.log('[STEP 9b] ✓ Page reloaded (F5). Waiting for stabilization...');
                        await this.sleep(5000 + Math.floor(Math.random() * 3000));
                    } catch (e) { this.log(`[STEP 9b] Page reload warning: ${e.message}`); }

                    this.log(`[STEP 9b] Escalating to Orchestrator Phase 1...`);
                    this._uaSubmitRetryCount = 0;
                    this._uaMaxRetries = 0;
                    break; // Fall through to error handling → throw UNUSUAL_ACTIVITY_BAN
                }



                // --- queue_cancelled recovery ---
                if (hasError && (currentErrorReason === 'queue_cancelled' || currentErrorReason.startsWith('queue_cancelled'))) {
                    this.log('[STEP 9b] ⚠️ queue_cancelled detected. Reloading + 10s recovery...');
                    await this.sleep(3000 + Math.random() * 2000);
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    this.settingsApplied = false;
                    this._lastAppliedSettings = null;
                    await this.sleep(1500 + Math.random() * 1000);
                    let queueRecovered = false;
                    for (let r = 0; r < 10; r++) {
                        await this.sleep(1000);
                        const recovered = await this.safeEvaluate(page, (existingIds) => {
                            const isVisible = (el) => el.offsetParent !== null;
                            const isElementVisible = (el) => {
                                if (!el) return false;
                                let current = el;
                                while (current && current !== document.body) {
                                    const style = window.getComputedStyle(current);
                                    if (style.display === 'none' || style.visibility === 'hidden') {
                                        return false;
                                    }
                                    const rect = current.getBoundingClientRect();
                                    if (style.overflow === 'hidden' && rect.width <= 2 && rect.height <= 2) {
                                        return false;
                                    }
                                    current = current.parentElement;
                                }
                                const rect = el.getBoundingClientRect();
                                return rect.width > 0 && rect.height > 0;
                            };

                            const getVisibleText = (el) => {
                                if (!el) return '';
                                if (el.nodeType === Node.ELEMENT_NODE && !isElementVisible(el)) return '';
                                
                                if (el.nodeType === Node.TEXT_NODE) {
                                    return el.textContent || '';
                                }
                                
                                if (el.childNodes && el.childNodes.length > 0) {
                                    let text = '';
                                    for (const child of el.childNodes) {
                                        if (child.nodeType === Node.TEXT_NODE) {
                                            text += child.textContent || '';
                                        } else if (child.nodeType === Node.ELEMENT_NODE) {
                                            text += ' ' + getVisibleText(child);
                                        }
                                    }
                                    return text;
                                }
                                
                                return el.textContent || '';
                            };

                            const allTiles = Array.from(document.querySelectorAll('[data-tile-id]'));
                            const newTiles = allTiles.filter(t => !existingIds.includes(t.getAttribute('data-tile-id')));
                            if (newTiles.length > 0) {
                                for (const tile of newTiles) {
                                    const tileText = (getVisibleText(tile) || '').toLowerCase();
                                    const hasMedia = tile.querySelector('img, video') !== null;
                                    const hasError = tileText.includes('không thành công') || tileText.includes('chính sách') ||
                                        tileText.includes('vi phạm') || tileText.includes('hạn mức') ||
                                        tileText.includes('đã huỷ') || tileText.includes('không bị trừ') ||
                                        ((tileText.includes('rất tiếc') || tileText.includes('sorry')) && (tileText.includes('đã xảy ra lỗi') || tileText.includes('an error')));
                                    
                                    if (tileText.match(/\d+%/) || tileText.includes('đang tạo') || tileText.includes('generating') ||
                                        tileText.includes('queued') || tileText.includes('đang chờ') || tileText.includes('in queue') ||
                                        (!hasMedia && !hasError)) {
                                        return true;
                                    }
                                }
                            }

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
                        }, existingTileIds);
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
                if (hasError && (currentErrorReason === 'is_queued' || currentErrorReason.startsWith('is_queued'))) {
                    this.log('[STEP 9b] ❌ Job stuck in queue. Throwing to retry pipeline...');
                    throw new Error('MEDIA_GENERATION_FAILED: Job stuck in queued state.');
                }

                if (hasError) {
                    this.log(`[STEP 9b] Error detected: ${currentErrorReason}`);
                    break;
                }

                // --- Session expiry check ---
                if (await this.checkAndRecoverSession()) {
                    this.log('[STEP 9b] Session dropped mid-render. Throwing...');
                    await page.reload({ waitUntil: 'domcontentloaded' });
                    throw new Error('SESSION_DROPPED: Google session expired mid-render.');
                }

                // --- Login page redirect check (catches full-page redirect to accounts.google.com) ---
                try {
                    const currentUrl = await page.url();
                    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin/identifier') || currentUrl.includes('AccountChooser') || currentUrl.includes('/api/auth/signin') || currentUrl.includes('/api/auth/error')) {
                        this.log(`[STEP 9b] 🚨 Browser redirected to login/auth page: ${currentUrl.substring(0, 100)}... Session expired.`);
                        throw new Error('SESSION_DROPPED: Browser redirected to login page mid-render.');
                    }
                } catch (urlErr) {
                    if (urlErr.message.includes('SESSION_DROPPED')) throw urlErr;
                    // page.url() can fail during navigation — ignore
                }

                // Angular: follow the same render card. Legacy UI: inspect new tiles.
                const tileStatus = await this.safeEvaluate(page, ([existingIds, elapsedSeconds]) => {
                    if (window.__harumiTileTracker?.read) {
                        return window.__harumiTileTracker.read(existingIds);
                    }
                    const isVisible = (el) => el.offsetParent !== null;
                    const isElementVisible = (el) => {
                        if (!el) return false;
                        let current = el;
                        while (current && current !== document.body) {
                            const style = window.getComputedStyle(current);
                            if (style.display === 'none' || style.visibility === 'hidden') {
                                return false;
                            }
                            const rect = current.getBoundingClientRect();
                            if (style.overflow === 'hidden' && rect.width <= 2 && rect.height <= 2) {
                                return false;
                            }
                            current = current.parentElement;
                        }
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    };

                    const getVisibleText = (el) => {
                        if (!el) return '';
                        if (el.nodeType === Node.ELEMENT_NODE && !isElementVisible(el)) return '';
                        
                        if (el.nodeType === Node.TEXT_NODE) {
                            return el.textContent || '';
                        }
                        
                        if (el.childNodes && el.childNodes.length > 0) {
                            let text = '';
                            for (const child of el.childNodes) {
                                if (child.nodeType === Node.TEXT_NODE) {
                                    text += child.textContent || '';
                                } else if (child.nodeType === Node.ELEMENT_NODE) {
                                    text += ' ' + getVisibleText(child);
                                }
                            }
                            return text;
                        }
                        
                        return el.textContent || '';
                    };

                    const allTiles = Array.from(document.querySelectorAll('[data-tile-id]'));
                    const newTiles = allTiles.filter(t => !existingIds.includes(t.getAttribute('data-tile-id')));
                    if (newTiles.length === 0) return { state: 'waiting', tileCount: 0 };

                    const angularTile = newTiles.find(t => t.matches('flow-grid-tile-container'));
                    if (angularTile) {
                        const state = angularTile.getAttribute('data-harumi-flow-state');
                        const media = angularTile.querySelector('img.thumbnail') || angularTile;
                        const rect = media.getBoundingClientRect();
                        return {
                            state: state === 'complete' ? 'complete' : 'generating',
                            tileId: angularTile.getAttribute('data-tile-id'),
                            percent: Number(angularTile.getAttribute('data-harumi-flow-percent') || 0),
                            coords: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }
                        };
                    }

                    // Quick scan: check ALL tiles for generating state, but ONLY newest tile for errors
                    // Old error tiles should be ignored — they were already handled or belong to previous attempts
                    for (let i = 0; i < newTiles.length; i++) {
                        const tile = newTiles[i];
                        const tileId = tile.getAttribute('data-tile-id');
                        const tileText = (getVisibleText(tile) || '').toLowerCase();
                        const r = tile.getBoundingClientRect();
                        const coords = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };

                        const hasMedia = tile.querySelector('img, video') !== null;

                        // Generating state checks — apply to ALL tiles (any tile generating = keep waiting)
                        const percentMatch = tileText.match(/(\d+)%/);
                        if (percentMatch) {
                            return { state: 'generating', tileId, coords, percent: parseInt(percentMatch[1]) };
                        }
                        if (tileText.includes('đang tạo') || tileText.includes('generating') ||
                            tileText.includes('queued') || tileText.includes('đang chờ') || tileText.includes('in queue')) {
                            return { state: 'generating', tileId, coords, percent: 0 };
                        }

                        // Error checks — ONLY on the newest tile (index 0)
                        if (i === 0) {
                            const hasAudioErr = tileText.includes('âm thanh') || tileText.includes('audio');
                            const hasPromptSuggestion = tileText.includes('vui lòng thử') || tileText.includes('câu lệnh khác') || tileText.includes('try another') || tileText.includes('try a different');
                            const isGenericError = (tileText.includes('rất tiếc') || tileText.includes('sorry')) && (tileText.includes('đã xảy ra lỗi') || tileText.includes('an error'));
                            const isThirdPartyViolation = tileText.includes('nhà cung cấp nội dung bên thứ ba') || tileText.includes('nội dung bên thứ ba') ||
                                tileText.includes('third-party content') || tileText.includes('third party content') || tileText.includes('content provider');
                            const hasError = (tileText.includes('không thành công') && (tileText.includes('chính sách') || tileText.includes('vi phạm') || tileText.includes('policy'))) ||
                                isThirdPartyViolation ||
                                (hasAudioErr && hasPromptSuggestion && !hasMedia) ||
                                isGenericError ||
                                tileText.includes('unusual activity') || tileText.includes('hoạt động bất thường') ||
                                tileText.includes('hạn mức') || tileText.includes('giới hạn');

                            if (!hasMedia && !hasError) {
                                // Blank card without error on newest tile = generating
                                return { state: 'generating', tileId, coords, percent: 0 };
                            }
                            if (hasError) {
                                let errorReason = 'tile_generation_error';
                                if (isThirdPartyViolation) errorReason = 'third_party_content_violation';
                                else if (tileText.includes('chính sách') || tileText.includes('vi phạm') || tileText.includes('policy')) errorReason = 'prompt_policy_violation';
                                else if (tileText.includes('unusual activity') || tileText.includes('hoạt động bất thường')) errorReason = 'unusual_activity';
                                else if (tileText.includes('hạn mức') || tileText.includes('giới hạn')) errorReason = 'model_limit_exceeded';
                                return { state: 'error', tileId, coords, text: tileText.substring(0, 300), errorReason };
                            }
                        }
                        // Old tiles (i > 0) with errors or completed media — just skip them
                    }

                    // No generating tile → check NEWEST tile only
                    const tile = newTiles[0];
                    const tileId = tile.getAttribute('data-tile-id');
                    const tileText = (getVisibleText(tile) || '').toLowerCase();
                    const r = tile.getBoundingClientRect();
                    const coords = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };

                    // Re-check error state for newest tile (the loop above skips error tiles
                    // that have media elements like warning icons, causing them to fall through here)
                    const hasAudioErr = tileText.includes('âm thanh') || tileText.includes('audio');
                    const hasPromptSuggestion = tileText.includes('vui lòng thử') || tileText.includes('câu lệnh khác') || tileText.includes('try another') || tileText.includes('try a different');
                    const isGenericError = (tileText.includes('rất tiếc') || tileText.includes('sorry')) && (tileText.includes('đã xảy ra lỗi') || tileText.includes('an error'));
                    const isThirdPartyViolation2 = tileText.includes('nhà cung cấp nội dung bên thứ ba') || tileText.includes('nội dung bên thứ ba') ||
                        tileText.includes('third-party content') || tileText.includes('third party content') || tileText.includes('content provider');
                    const tileHasError = (tileText.includes('không thành công') && (tileText.includes('chính sách') || tileText.includes('vi phạm') || tileText.includes('policy'))) ||
                        isThirdPartyViolation2 ||
                        (hasAudioErr && hasPromptSuggestion) ||
                        isGenericError ||
                        tileText.includes('unusual activity') || tileText.includes('hoạt động bất thường') ||
                        tileText.includes('hạn mức') || tileText.includes('giới hạn');

                    if (tileHasError) {
                        let errorReason = 'tile_generation_error';
                        if (isThirdPartyViolation2) errorReason = 'third_party_content_violation';
                        else if (tileText.includes('chính sách') || tileText.includes('vi phạm') || tileText.includes('policy')) errorReason = 'prompt_policy_violation';
                        else if (tileText.includes('unusual activity') || tileText.includes('hoạt động bất thường')) errorReason = 'unusual_activity';
                        else if (tileText.includes('hạn mức') || tileText.includes('giới hạn')) errorReason = 'model_limit_exceeded';
                        return { state: 'error', tileId, coords, text: tileText.substring(0, 300), errorReason };
                    }

                    // Check completed
                    const videoEl = tile.querySelector('video');
                    if (videoEl && isVisible(videoEl) && videoEl.duration > 0 && !isNaN(videoEl.duration)) {
                        const vr = videoEl.getBoundingClientRect();
                        return { state: 'complete', tileId, coords: { x: Math.round(vr.x + vr.width / 2), y: Math.round(vr.y + vr.height / 2) } };
                    }
                    const imgEl = tile.querySelector('img');
                    if (imgEl && isVisible(imgEl) && imgEl.getBoundingClientRect().width > 80) {
                        const ir = imgEl.getBoundingClientRect();
                        return { state: 'complete', tileId, coords: { x: Math.round(ir.x + ir.width / 2), y: Math.round(ir.y + ir.height / 2) } };
                    }

                    // Unknown → treat as generating
                    return { state: 'generating', tileId, coords, percent: -1 };
                }, [existingTileIds, waitTime]);

                // Log tile status periodically
                if (tileStatus.state !== this._lastTileState || tileStatus.percent !== this._lastTilePercent) {
                    this.log(`[STEP 9b] Tile status: ${tileStatus.state} ${tileStatus.tileId ? `(${tileStatus.tileId.substring(0, 20)})` : ''} ${tileStatus.percent !== undefined ? tileStatus.percent + '%' : ''}`);
                    this._lastTileState = tileStatus.state;
                    this._lastTilePercent = tileStatus.percent;
                }

                if (tileStatus.state === 'complete') {
                    this.log('[STEP 9b] ✓ Render COMPLETE — media element detected on new tile.');
                    targetMediaCoords = tileStatus.coords;
                    completedTileId = tileStatus.tileId;
                    this.hasSeenGenerating = true;

                    this.successfulGenerations = (this.successfulGenerations || 0) + 1;
                    if (this.successfulGenerations >= 50) {
                        this.log(`[Worker] 🎉 50 consecutive successful generations! Flagging for proactive reset...`);
                        this.needsProactiveReset = true;
                    }

                    this._tileSubmitRetryCount = 0;
                    this._tileRetryMax = 0;
                    break;
                }

                if (tileStatus.state === 'error') {
                    this.log(`[STEP 9b] ❌ New tile shows error: ${tileStatus.text}`);

                    this._tileSubmitRetryCount = (this._tileSubmitRetryCount || 0) + 1;
                    if (!this._tileRetryMax) {
                        this._tileRetryMax = 3 + Math.floor(Math.random() * 3); // 3-5 lần
                    }

                    if (this._tileSubmitRetryCount <= this._tileRetryMax) {
                        this.log(`[STEP 9b] ⚠️ Tile generation error detected. Retrying submit (${this._tileSubmitRetryCount}/${this._tileRetryMax})...`);

                        if (tileStatus.tileId) {
                            this.log(`[STEP 9b] Adding failed tile ID ${tileStatus.tileId} to existingTileIds to isolate future attempts.`);
                            existingTileIds.push(tileStatus.tileId);
                        }

                        const retryWait = 3000 + Math.floor(Math.random() * 2000); // 3-5s
                        this.log(`[STEP 9b] Waiting ${Math.round(retryWait / 1000)}s before submit retry...`);
                        await this.sleep(retryWait);

                        // Re-click submit button
                        const retrySubmit = await this._findSubmitButtonCoords(page);

                        if (retrySubmit.found) {
                            this.log(`[STEP 9b] Re-clicking submit at x:${retrySubmit.x}, y:${retrySubmit.y}...`);
                            await this.humanClick(page, retrySubmit.x, retrySubmit.y);
                        } else {
                            this.log('[STEP 9b] ⚠️ Submit button not found for retry. Trying Enter...');
                            await page.keyboard.press('Enter');
                        }

                        await this.sleep(1000 + Math.random() * 1000);
                        continue; // Keep polling
                    }

                    this.log(`[STEP 9b] ❌ Tile generation error persists after ${this._tileRetryMax} submit retries.`);
                    this._tileSubmitRetryCount = 0;
                    this._tileRetryMax = 0;
                    hasError = true;
                    currentErrorReason = tileStatus.errorReason || 'tile_generation_error';
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
                        await this.safeEvaluate(page, () => window.scrollTo(0, 0)).catch(() => {});
                        this.scrolledToTopDuringRender = true;
                    }
                }
            }

            if (page) {
                page.off('console', consoleHandler);
                page.off('response', responseHandler);
            }
            clearInterval(downloadInterval);

            // --- 9c: Error handling ---
            if (hasError) {
                if (currentErrorReason.startsWith('model_limit_exceeded')) {
                    this.log(`[STEP 9c] ${currentErrorReason} detected. Throwing model limit exceeded to Orchestrator...`);
                    throw new Error('MODEL_LIMIT_EXCEEDED: Nano Banana 2 limit reached.');
                }
                if (currentErrorReason.startsWith('unusual_activity') || currentErrorReason.startsWith('403_Forbidden')) {
                    this.log(`[STEP 9c] ${currentErrorReason} detected. Throwing to Orchestrator for recovery...`);
                    throw new Error('UNUSUAL_ACTIVITY_BAN: 403_Forbidden or unusual activity detected.');
                }
                if (currentErrorReason === 'prompt_policy_violation') {
                    this.log(`[STEP 9c] ${currentErrorReason} detected. Throwing to Orchestrator for prompt truncation...`);
                    throw new Error('MEDIA_GENERATION_FAILED: prompt_policy_violation');
                }
                if (currentErrorReason === 'third_party_content_violation') {
                    this.log(`[STEP 9c] ${currentErrorReason} detected. Throwing to Orchestrator for third party retry...`);
                    throw new Error('MEDIA_GENERATION_FAILED: third_party_content_violation');
                }
                this.log(`[STEP 9c] Generation failed: ${currentErrorReason}. Reloading...`);
                await page.reload({ waitUntil: 'domcontentloaded' });
                this.settingsApplied = false;
                this._lastAppliedSettings = null;
                this.viewModeApplied = false;
                await this.sleep(2000 + Math.random() * 1000);
                throw new Error(`MEDIA_GENERATION_FAILED: ${currentErrorReason}`);
            }

            if (!this.hasSeenGenerating) {
                this.log('[STEP 9c] ⚠️ Timeout: no render indicator ever detected. Reloading...');
                await page.reload({ waitUntil: 'domcontentloaded' });
                this.settingsApplied = false;
                this._lastAppliedSettings = null;
                this.viewModeApplied = false;
                throw new Error('MEDIA_GENERATION_FAILED: No render progress detected within timeout.');
            }

            // --- 9e: Clear prompt box ---
            this.log('[STEP 9e] Clearing prompt box before download...');
            try {
                // Keep ingredient attachments for the next record; Step 8 replaces only text.
                const keepIngredients = !!this._referenceIngredients;
                const clearCoords = keepIngredients ? null : await this.safeEvaluate(page, () => {
                    const btns = Array.from(document.querySelectorAll('button'));
                    for (const btn of btns) {
                        const text = (btn.textContent || '').trim().toLowerCase();
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
            // Safety Check: scan for policy violation ONLY in VISIBLE elements before right-clicking
            const preDownloadCheck = await this.safeEvaluate(page, () => {
                const isElementVisible = (el) => {
                    if (!el) return false;
                    let current = el;
                    while (current && current !== document.body) {
                        const style = window.getComputedStyle(current);
                        if (style.display === 'none' || style.visibility === 'hidden') return false;
                        current = current.parentElement;
                    }
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                // Only check visible alerts and banners, NOT entire body text
                const candidates = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"]'));
                for (const el of candidates) {
                    if (!isElementVisible(el)) continue;
                    const t = (el.textContent || '').toLowerCase();
                    if (t.includes('vi phạm chính sách') || 
                        t.includes('tạo nội dung gây hại') || 
                        t.includes('câu lệnh này có thể vi phạm') ||
                        ((t.includes('chính sách') || t.includes('vi phạm') || t.includes('policy')) && 
                         (t.includes('không thành công') || t.includes('câu lệnh khác') || t.includes('gây hại')))) {
                        return { isError: true, reason: 'prompt_policy_violation', text: 'pre_download_visible_alert: ' + t.substring(0, 300) };
                    }
                }
                return null;
            });
            if (preDownloadCheck) {
                this.log(`[STEP 9f] 🛑 Policy violation detected in VISIBLE alert before right-click. Aborting download.`);
                throw new Error('MEDIA_GENERATION_FAILED: prompt_policy_violation');
            }
            // Sử dụng humanClick thay vì rawMouse để né bot detection



            // Register download event BEFORE interaction
            const isIMG = job.TYPE_VIDEO === 'IMG';
            const downloadGate = createDownloadGate(page, async download => {
                const ext = path.extname(download.suggestedFilename() || '') || (isIMG ? '.png' : '.mp4');
                const safeName = String(job.JOB_ID).replace(/[<>:"/\\|?*]/g, '_');
                return saveDownloadedFile(
                    download, outputDir, `${safeName}${ext}`, message => this.log(`[STEP 9f] ${message}`),
                    outputDir
                );
            }, message => this.log(`[STEP 9f] ${message}`),
            () => this.isKilled || (this.automationService && !this.automationService.isRunning));
            cancelDownload = downloadGate.cancel;
            this.log('[STEP 9f] Giữ tại bước Download đến khi tải và lưu file thành công. Có thể bấm tải thủ công trên trình duyệt.');
            const attemptDownload = async () => {
            if (!downloadGate.canRetry()) return;
            if (!isIMG && completedTileId?.startsWith('harumi-flow-')) {
                const quality = job.settings?.videoQuality || job.settings?.videoSettings?.resolution || '1080p';
                this.log(`[STEP 9f] Downloading tracked tile ${completedTileId} at ${quality}...`);
                await require('./flowGeneration').clickAngularVideoDownload(page, completedTileId, quality, 10000, message => this.log(message), downloadGate.canRetry);
                this.log(`[STEP 9f] Quality button click completed: ${quality}; waiting for download.`);
            } else {
            // Scroll to top for accurate coordinates
            await this.safeEvaluate(page, () => window.scrollTo(0, 0)).catch(() => {});
            await this.sleep(500);

            if (completedTileId) {
                const updatedCoords = await this.safeEvaluate(page, (tileId) => {
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

            // 2a. Verify context menu thực sự mở, nếu không retry right-click (max 2 lần)
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
                    const t = (item.textContent || '').trim().toLowerCase();
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
            this.log(`[STEP 9f] Clicking "Tải xuống" at x:${Math.round(dlX)}, y:${Math.round(dlY)}...`);
            if (!downloadGate.canRetry()) return;
            await this.humanClick(page, dlX, dlY, { humanConfig: { idle_between_actions: false } });
            await this.sleep(800 + Math.floor(Math.random() * 400)); // Wait for quality submenu to appear

            // --- Select quality from submenu (270p / 720p / 1080p / 4K) ---
            const resolution = job.settings?.videoQuality || job.settings?.videoSettings?.resolution || '1080p';
            const imgQuality = job.settings?.imgQuality || '1K';
            const type = job.TYPE_VIDEO;
            const targetQuality = isIMG ? imgQuality : resolution;
            this.log(`[STEP 9f] Looking for quality submenu (target: ${targetQuality})...`);

            if (!isIMG) {
                this.log(`[STEP 9f] Clicking exact Flow quality button: ${targetQuality}`);
                await require('./flowGeneration').clickAngularDownloadQuality(page, targetQuality);
                this.log(`[STEP 9f] Quality button click completed: ${targetQuality}; waiting for download.`);
            } else {
                const qualityCoords = await page.evaluate(({ type, resolution, imgQuality }) => {
                    // Submenu items can be in various containers — search broadly
                    const allItems = Array.from(document.querySelectorAll(
                        '[role="menu"] li, [role="menu"] [role="menuitem"], [role="menu"] button, [role="menu"] div, [role="listbox"] div, div[class*="menu"] div'
                    ));
                    let fallbackCoords = null;
                    for (const item of allItems) {
                        const t = (item.textContent || '').trim();
                        const firstLine = t.split('\n')[0].trim(); // Quality label is first line (e.g. "1080p")
                        const r = item.getBoundingClientRect();
                        if (r.width <= 30 || r.height <= 10 || r.x <= 0 || r.y <= 0) continue;
                        const coords = { x: r.x + r.width / 2 + (Math.random() * 10 - 5), y: r.y + r.height / 2 + (Math.random() * 6 - 3) };

                        if (type === 'IMG') {
                            // Image quality: try exact match first (e.g. "2K" → must start with "2K")
                            const isQualityItem = firstLine.startsWith('1K') || firstLine.startsWith('2K') || firstLine.startsWith('4K')
                                || firstLine.toLowerCase().includes('original') || firstLine.toLowerCase().includes('gốc')
                                || firstLine.toLowerCase().includes('png') || firstLine.toLowerCase().includes('jpeg');
                            if (!isQualityItem) continue;

                            // Exact target match
                            if (firstLine.startsWith(imgQuality)) return coords;

                            // Save first quality item as fallback
                            if (!fallbackCoords) fallbackCoords = coords;
                        } else {
                            // Video quality: exact resolution match
                            if (firstLine.includes(resolution)) return coords;

                            // Save any video quality item as fallback
                            if ((firstLine === '1080p' || firstLine === '720p' || firstLine === '4K' || firstLine === '270p') && !fallbackCoords) {
                                fallbackCoords = coords;
                            }
                        }
                    }
                    return fallbackCoords; // Return fallback if exact match not found
                }, { type, resolution, imgQuality });

                if (qualityCoords) {
                    const qX = qualityCoords.x + (Math.random() * 6 - 3);
                    const qY = qualityCoords.y + (Math.random() * 4 - 2);
                    this.log(`[STEP 9f] Clicking quality "${targetQuality}" at x:${Math.round(qX)}, y:${Math.round(qY)}`);
                    await this.humanClick(page, qX, qY, { humanConfig: { idle_between_actions: false } });
                } else {
                    // Fallback: no submenu appeared, click "Tải xuống" directly
                    this.log('[STEP 9f] Quality submenu not found, clicking "Tải xuống" directly.');
                    await this.humanClick(page, dlX, dlY, { humanConfig: { idle_between_actions: false } });
                }
            }
            await this.sleep(600 + Math.floor(Math.random() * 400)); // Cooldown after download click

            }

            };
            this.log('[STEP 9f] Di chuột chậm tới nút tải; thử lại sau 5 giây nếu chưa bắt đầu tải. Khi đang tải/lưu sẽ ngừng bấm. Nhấn Dừng để hủy.');
            const destPath = await downloadGate.retryUntilSaved(attemptDownload);
            downloadedFile = destPath;
            jobSuccess = true;
            this.unusualActivityStreak = 0; // Reset streak on successful download
            this.lastSuccessfulDownloadAt = Date.now(); // Track for 15-min no-download restart
            this.log(`[STEP 9f] ✓ Download complete: ${destPath}`);
        } catch (e) {
            try { cancelDownload(); } catch (_) { /* noop */ }
            this.log(`[STEP 9] Render/Download failed: ${e.message}`);
            if (page) {
                await page.keyboard.press('Escape').catch(() => {});
                page.off('console', consoleHandler);
                page.off('response', responseHandler);
            }
            clearInterval(downloadInterval);
            jobSuccess = false;
            throw e; // Download now handled inline in waitAndDownload() step 9f using page.waitForEvent('download') + download.saveAs() pattern.
        }

        return { success: jobSuccess, file: downloadedFile };
    }

    async _internalProcessJob(job, outputDir) {
        this.log(`[Orchestrator] Starting 9-Step Pipeline for Job ${job.JOB_ID}`);
        // Reset unusual activity and audio submit retry counters for new job
        this._uaSubmitRetryCount = 0;
        this._uaMaxRetries = 0;
        this._audioSubmitRetryCount = 0;
        this._audioMaxRetries = 0;
        this._lastTileState = null;

        // Clear session-level upload cache only if we are not reusing project
        const currentUrl = this.page ? this.page.url() : '';
        const inActiveProject = isFlowProjectUrl(currentUrl);
        if (!inActiveProject) {
            this._uploadedImages.clear();
        }
        try {
            await this.ensureBrowserReady();

            // Natural resting delay between jobs
            if (isFlowUrl(this.page.url())) {
                const restDelay = 1000 + Math.floor(Math.random() * 2000);
                this.log(`[ANTI-BOT] Nghỉ ngơi ${Math.round(restDelay / 1000)}s trước khi làm job tiếp theo...`);
                await this.sleep(restDelay);
            }

            await this.clickCreateWithFlow(this.page);
            await this.clickNewProject(this.page);
            await this.verifyProjectPage(this.page);
            await require('./flowGeneration').assertGenerationCredits(this.page);
            await this.checkAndToggleAgentButton(this.page);
            await this.setupViewMode(this.page);
            await this.setupCreateMenu(this.page, job);
            await this.uploadReferenceImages(this.page, job);
            await this.pastePromptAndSubmit(this.page, job);
            return await this.waitAndDownload(this.page, job, outputDir);
        } catch (err) {
            if (err.message?.includes('FLOW_CREDITS_EXHAUSTED') && !this.automationService?.handlesCreditExhaustion) {
                // Older API processes reload workers but retain their service module.
                // Stop that existing service before its generic error handler can restart us.
                this.log('HẾT CREDIT TẠO VIDEO! TỰ ĐỘNG TẠM DỪNG TÁC VỤ VÀ ĐÓNG TRÌNH DUYỆT. VUI LÒNG NẠP CREDIT TRƯỚC KHI CHẠY TIẾP.');
                this.isKilled = true;
                const service = require.cache[require.resolve('./automationService')]?.exports;
                if (service?.globalState && service?.stopAutomation) {
                    // Do not await: stopAutomation drains this pipeline's running task.
                    const stopping = service.stopAutomation();
                    stopping.catch(error => this.log(`LỖI DỪNG TÁC VỤ: ${error.message}`.toUpperCase()));
                } else {
                    await this.close();
                }
            }
            this.log(`[Orchestrator] Pipeline failed at some step: ${err.message}`);
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

    /**
     * Dismiss the Google Labs AI assistant chat panel if it's open.
     * This panel has identical Slate editor, + button, and submit button
     * as the main creation editor — causing querySelector to match the
     * wrong input and paste prompts/upload images into the chat panel.
     */
    async dismissChatPanel(page) {
        const dismissed = await this.safeEvaluate(page || this.page, () => {
            // Marker: resize separator unique to chat panel
            const separator = document.querySelector(
                'div[aria-label="Đổi kích thước bảng điều khiển tác nhân"], ' +
                'div[aria-label="Resize agent panel"]'
            );
            if (!separator) return null;

            // Walk up to find panel container with h2 title
            const panelRoot = separator.closest('div.sc-4e96504a-0') || separator.parentElement;
            if (!panelRoot) return null;
            const h2 = panelRoot.querySelector('h2');
            if (!h2) return null;
            const title = (h2.textContent || '').trim();
            if (title !== 'Phiên không có tiêu đề' && title !== 'Untitled session' && !title.includes('tiêu đề')) return null;

            // Find close button: <i class="google-symbols">close</i> inside panel header
            const buttons = Array.from(panelRoot.querySelectorAll('button'));
            const closeBtn = buttons.find(btn => {
                const icon = btn.querySelector('i.google-symbols, i[class*="google-symbols"]');
                return icon && icon.textContent.trim() === 'close';
            });

            if (closeBtn && closeBtn.offsetParent !== null) {
                closeBtn.click();
                return 'clicked';
            }
            return null;
        }).catch(() => null);

        if (dismissed) {
            this.log('[ChatPanel] ✓ Dismissed AI assistant chat panel to prevent selector collision.');
            await this.sleep(500 + Math.random() * 300);
        }
    }

    async clearGoogleLabsCookies(page) {
        this.log('[Worker] Clearing cookies aggressively (whitelist mode) to resolve 403...');
        const targetPage = page || this.page;
        if (!targetPage) return;
        try {
            const context = targetPage.context();
            const allCookies = await context.cookies();
            this.log(`[Worker] Total cookies before clear: ${allCookies.length}`);

            // WHITELIST approach: Only keep essential Google AUTH cookies.
            // Everything else (rate-limit, ban state, session tokens, tracking) gets purged.
            const AUTH_COOKIE_NAMES = new Set([
                // Core Google login cookies — removing these forces re-login
                'sid', 'hsid', 'ssid', 'apisid', 'sapisid',
                '__secure-1psid', '__secure-3psid',
                '__secure-1papisid', '__secure-3papisid',
                'lsid',
                // OAuth consent
                '__secure-osid',
                // Account chooser
                'socs',
            ]);

            // Only keep cookies that are: (a) on google.com domain AND (b) in the auth whitelist
            const cookiesToKeep = allCookies.filter(c => {
                const domain = (c.domain || '').toLowerCase();
                const name = (c.name || '').toLowerCase();

                // Only consider keeping cookies on core Google auth domains
                const isGoogleAuthDomain = 
                    domain === '.google.com' || 
                    domain === 'google.com' ||
                    domain.includes('accounts.google.com') ||
                    domain.includes('myaccount.google.com');

                if (!isGoogleAuthDomain) return false; // Purge all non-core domains

                return AUTH_COOKIE_NAMES.has(name);
            });

            const deletedCount = allCookies.length - cookiesToKeep.length;

            // Clear all cookies first, then re-add only the auth whitelist
            await context.clearCookies();
            if (cookiesToKeep.length > 0) {
                await context.addCookies(cookiesToKeep);
            }

            this.log(`[Worker] ✓ Purged ${deletedCount} cookies (rate-limit, ban state, tracking). Retained ${cookiesToKeep.length} core auth cookies.`);

            // Clear localStorage + sessionStorage for labs/flow origins to purge cached ban state
            // If the page is currently on a non-labs origin (like a 403 page or accounts.google.com),
            // navigate to Flow first so localStorage.clear() targets the correct origin.
            try {
                const currentUrl = targetPage.url() || '';
                if (!isFlowUrl(currentUrl)) {
                    this.log('[Worker] Page is not on Flow. Navigating to Flow to clear Local Storage...');
                    await targetPage.goto('https://flow.google.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                }

                await targetPage.evaluate(() => {
                    try {
                        // Clear localStorage (may contain cached ban/rate-limit state)
                        if (window.localStorage) localStorage.clear();
                        // Clear sessionStorage (ephemeral, safe to nuke)
                        if (window.sessionStorage) sessionStorage.clear();
                    } catch (e) { /* cross-origin or sandboxed */ }
                }).catch(() => {});
                this.log('[Worker] ✓ Local Storage and Session Storage cleared on Flow.');
            } catch (err) {
                this.log(`[Worker] Evaluate clear storage warning: ${err.message}`);
            }

            // Robust fallback via CDP to clear Flow storage even if navigation failed
            try {
                const client = await context.newCDPSession(targetPage);
                await client.send('DOMStorage.clear', {
                    storageId: {
                        securityOrigin: 'https://flow.google.com',
                        isLocalStorage: true
                    }
                }).catch(() => {});
                await client.detach().catch(() => {});
                this.log('[Worker] ✓ CDP DOMStorage.clear fallback executed for https://flow.google.com.');
            } catch (cdpErr) {
                // Ignore CDP session errors if unsupported or closed
            }
        } catch (e) {
            this.log('[Worker] Error clearing cookies: ' + e.message);
        }
    }

    async checkIfBanned(page) {
        const targetPage = page || this.page;
        if (!targetPage) return false;
        try {
            // Check VISIBLE alerts only — body.textContent includes stale text from old tiles
            const hasBanText = await targetPage.evaluate(() => {
                const isElementVisible = (el) => {
                    if (!el) return false;
                    let current = el;
                    while (current && current !== document.body) {
                        const style = window.getComputedStyle(current);
                        if (style.display === 'none' || style.visibility === 'hidden') return false;
                        current = current.parentElement;
                    }
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                };
                // Check visible alerts and prominent text elements
                const candidates = Array.from(document.querySelectorAll('[role="alert"], [role="alertdialog"], h1, h2, h3, .error, [class*="error"]'));
                for (const el of candidates) {
                    if (!isElementVisible(el)) continue;
                    const t = (el.textContent || '').toLowerCase();
                    if (t.includes('unusual activity') ||
                        t.includes('hoạt động bất thường') ||
                        t.includes('403 forbidden') ||
                        t.includes('access denied')) {
                        return true;
                    }
                }
                // Also check if the page itself is a full-page error (HTTP 403)
                const title = (document.title || '').toLowerCase();
                if (title.includes('403') || title.includes('forbidden') || title.includes('denied')) return true;
                return false;
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
        if (this.isKilled) return;
        if (!this.automationService) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        let remaining = ms;
        const checkInterval = 200;
        let pausedStart = null;

        while (remaining > 0) {
            if (this.isKilled || !this.automationService?.isRunning) {
                if (pausedStart !== null) {
                    this.jobPausedDurationMs = (this.jobPausedDurationMs || 0) + (Date.now() - pausedStart);
                }
                return;
            }

            if (this.automationService?.isPaused) {
                if (pausedStart === null) {
                    pausedStart = Date.now();
                }
                await new Promise(resolve => setTimeout(resolve, checkInterval));
                continue;
            } else {
                if (pausedStart !== null) {
                    this.jobPausedDurationMs = (this.jobPausedDurationMs || 0) + (Date.now() - pausedStart);
                    pausedStart = null;
                }
            }

            const chunk = Math.min(checkInterval, remaining);
            await new Promise(resolve => setTimeout(resolve, chunk));
            remaining -= chunk;
        }

        while (this.automationService?.isPaused && !this.isKilled && this.automationService?.isRunning) {
            if (pausedStart === null) {
                pausedStart = Date.now();
            }
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        if (pausedStart !== null) {
            this.jobPausedDurationMs = (this.jobPausedDurationMs || 0) + (Date.now() - pausedStart);
        }
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


}

module.exports = AutomationWorker;
