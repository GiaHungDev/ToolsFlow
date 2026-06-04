const path = require('path');
const fs = require('fs');

class BrowserPool {
    constructor(io) {
        this.io = io;
        // Map: workerId -> { browser, profilePath }
        this.pool = new Map();
    }

    log(msg) {
        const message = `[BrowserPool] ${msg}`;
        console.log(message);
        if (this.io) this.io.emit('log', message);
    }

    static log(msg) {
        const message = `[BrowserPool] ${msg}`;
        console.log(message);
    }

    register(workerId, browser, profilePath) {
        this.pool.set(workerId, { browser, profilePath });
        this.log(`Worker ${workerId} registered browser at: ${profilePath}`);
    }

    async closeBrowser(workerId) {
        const entry = this.pool.get(workerId);
        if (!entry) return;

        try {
            if (entry.browser) {
                await entry.browser.close();
            }
        } catch (e) {
            this.log(`Lỗi khi đóng trình duyệt cho Worker ${workerId}: ${e.message}`);
        }

        this.pool.delete(workerId);
        this.log(`Worker ${workerId} closed and removed browser from pool.`);
    }

    async closeAll() {
        const workerIds = Array.from(this.pool.keys());
        for (const id of workerIds) {
            await this.closeBrowser(id);
        }
        this.log(`Đã đóng toàn bộ trình duyệt (${workerIds.length} instances).`);
    }

    getAllWindowInfo() {
        const info = [];
        for (const [workerId, entry] of this.pool.entries()) {
            info.push({
                workerId,
                profilePath: entry.profilePath,
                isConnected: entry.browser ? entry.browser.isConnected() : false
            });
        }
        return info;
    }

    static cleanStaleLocks(profilePath) {
        const lockFiles = [
            'SingletonLock',
            'SingletonCookie',
            'SingletonSocket'
        ];
        
        // 1. Clean singleton lock files
        for (const file of lockFiles) {
            const filePath = path.join(profilePath, file);
            if (fs.existsSync(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    BrowserPool.log(`[Lock Cleaner] Đã xóa stale lock file: ${filePath}`);
                } catch (e) {
                    try {
                        fs.rmSync(filePath, { force: true });
                    } catch (err) {
                        BrowserPool.log(`[Lock Cleaner] Không thể xóa file ${filePath}: ${err.message}`);
                    }
                }
            }
        }

        // 2. Clean session restore files
        const defaultDir = path.join(profilePath, 'Default');
        if (fs.existsSync(defaultDir)) {
            const sessionFiles = [
                'Last Session',
                'Current Session',
                'Last Tabs',
                'Current Tabs'
            ];
            for (const file of sessionFiles) {
                const filePath = path.join(defaultDir, file);
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        BrowserPool.log(`[Session Cleaner] Đã xóa session restore file: ${filePath}`);
                    } catch (e) {}
                }
            }
            const sessionsDir = path.join(defaultDir, 'Sessions');
            if (fs.existsSync(sessionsDir)) {
                try {
                    fs.rmSync(sessionsDir, { recursive: true, force: true });
                    BrowserPool.log(`[Session Cleaner] Đã xóa sessions directory: ${sessionsDir}`);
                } catch (e) {}
            }
        }
    }

    static injectPreferences(profilePath) {
        try {
            const setPrefs = (prefs) => {
                if (!prefs.profile) prefs.profile = {};
                prefs.profile.cookie_controls_mode = 2;
                prefs.profile.block_third_party_cookies = true;
                prefs.enable_do_not_track = true;
                
                if (!prefs.privacy_sandbox) prefs.privacy_sandbox = {};
                prefs.privacy_sandbox.related_website_sets_enabled = false;
                prefs.privacy_sandbox.first_party_sets_enabled = false;
                
                if (!prefs.session) prefs.session = {};
                prefs.session.restore_on_startup = 1;
                prefs.session.startup_urls = [];
                
                prefs.profile.exit_type = "Normal";
                prefs.profile.exited_cleanly = true;
                
                return prefs;
            };

            const defaultDir = path.join(profilePath, 'Default');
            if (!fs.existsSync(defaultDir)) {
                fs.mkdirSync(defaultDir, { recursive: true });
            }

            const prefsPath = path.join(defaultDir, 'Preferences');
            if (fs.existsSync(prefsPath)) {
                let prefs = {};
                try {
                    prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8') || '{}');
                } catch (e) {}
                fs.writeFileSync(prefsPath, JSON.stringify(setPrefs(prefs), null, 2), 'utf8');
            } else {
                fs.writeFileSync(prefsPath, JSON.stringify(setPrefs({}), null, 2), 'utf8');
            }
            BrowserPool.log(`[Pref Injector] Đã thiết lập Preferences sạch cho profile tại: ${profilePath}`);
        } catch (e) {
            BrowserPool.log(`[Pref Injector] Lỗi inject Preferences: ${e.message}`);
        }
    }

    getExtensions() {
        const extensionsDir = path.join(process.cwd(), 'extensions');
        const extensionPaths = [];
        if (fs.existsSync(extensionsDir)) {
            try {
                const items = fs.readdirSync(extensionsDir);
                for (const item of items) {
                    const itemPath = path.join(extensionsDir, item);
                    if (fs.statSync(itemPath).isDirectory()) {
                        extensionPaths.push(itemPath);
                    }
                }
            } catch (e) {
                console.error('[Extensions] Error reading extensions dir:', e.message);
            }
        }
        return extensionPaths;
    }

    static removeUnsafeExtensions(profilePath, logger = null) {
        const logFunc = logger || ((msg) => BrowserPool.log(msg));
        const extensionsDir = path.join(profilePath, 'Default', 'Extensions');
        if (fs.existsSync(extensionsDir)) {
            try {
                fs.rmSync(extensionsDir, { recursive: true, force: true });
                logFunc(`[Extension Cleaner] Đã dọn dẹp các Extension không an toàn tại: ${extensionsDir}`);
            } catch (e) {
                logFunc(`[Extension Cleaner] Lỗi dọn dẹp Extensions: ${e.message}`);
            }
        }
    }
}

module.exports = BrowserPool;
