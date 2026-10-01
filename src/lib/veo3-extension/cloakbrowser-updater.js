/**
 * CloakBrowser Auto-Updater
 * 
 * Checks if installed cloakbrowser npm package is outdated and updates it.
 * Runs at automation startup (before workers launch browsers).
 * 
 * Strategy:
 *   1. Read installed version from node_modules/cloakbrowser/package.json
 *   2. Query npm registry for latest version
 *   3. If outdated → run `npm install cloakbrowser@latest` in backend dir
 *   4. CloakBrowser's own download.js handles Chromium binary updates on first launch
 * 
 * Failure is non-fatal — always resolves, never rejects.
 */

const path = require('path');
const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

const PACKAGE_NAME = 'cloakbrowser';

// Use user-writable directory for npm install when app is in a protected location (e.g. C:\Program Files)
function _getBackendDir() {
    const defaultDir = path.resolve(__dirname, '..', '..');
    if (/^[A-Za-z]:\\Program Files/i.test(defaultDir)) {
        // In production Electron on C drive, BACKEND_DIR is inside read-only resources.
        // Use USER_DATA_PATH or DRAMA_DATA_DIR (set by Electron main.ts) for npm operations.
        const userDataDir = process.env.USER_DATA_PATH || process.env.DRAMA_DATA_DIR;
        if (userDataDir) {
            const writable = path.join(path.dirname(userDataDir), 'cloakbrowser-npm');
            if (!fs.existsSync(writable)) fs.mkdirSync(writable, { recursive: true });
            // Copy package.json if it doesn't exist (npm needs it)
            const srcPkg = path.join(defaultDir, 'package.json');
            const destPkg = path.join(writable, 'package.json');
            if (!fs.existsSync(destPkg) && fs.existsSync(srcPkg)) {
                try { fs.copyFileSync(srcPkg, destPkg); } catch {}
            }
            return writable;
        }
    }
    return defaultDir;
}
const BACKEND_DIR = _getBackendDir();

function log(msg, io = null) {
    console.log(`[CloakBrowser Updater] ${msg}`);
    if (io) {
        io.emit('log', `[CloakBrowser Updater] ${msg}`);
    }
}

/** Emit startup phase to FE and persist for API polling */
function emitPhase(io, phase, message) {
    if (!io) return;
    const data = { phase, message };
    global._startupPhase = data;
    io.emit('startup-phase', data);
}

/**
 * Get installed cloakbrowser version from node_modules
 * Checks both BACKEND_DIR (may be user-writable redirect) and original resources dir
 */
function getInstalledVersion() {
    const dirsToCheck = [BACKEND_DIR];
    // Also check the original backend dir (inside resources) if it was redirected
    const originalDir = path.resolve(__dirname, '..', '..');
    if (originalDir !== BACKEND_DIR) dirsToCheck.push(originalDir);

    for (const dir of dirsToCheck) {
        try {
            const pkgPath = path.join(dir, 'node_modules', PACKAGE_NAME, 'package.json');
            if (!fs.existsSync(pkgPath)) continue;
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
            if (pkg.version) return pkg.version;
        } catch {}
    }
    return null;
}

/**
 * Fetch latest version from npm registry
 */
function fetchLatestVersion() {
    return new Promise((resolve) => {
        const options = {
            hostname: 'registry.npmjs.org',
            path: `/${PACKAGE_NAME}/latest`,
            method: 'GET',
            headers: { 'Accept': 'application/json', 'User-Agent': 'vfast-updater' },
            timeout: 10000,
        };

        const req = https.get(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const pkg = JSON.parse(data);
                    resolve(pkg.version || null);
                } catch {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/**
 * Compare semver versions. Returns true if `latest` is newer than `installed`.
 */
function isNewer(latest, installed) {
    if (!latest || !installed) return false;
    const a = latest.split('.').map(Number);
    const b = installed.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if ((a[i] || 0) > (b[i] || 0)) return true;
        if ((a[i] || 0) < (b[i] || 0)) return false;
    }
    return false;
}

/**
 * Run npm install to update cloakbrowser
 */
function installLatest(io = null) {
    log(`Running: npm install ${PACKAGE_NAME}@latest ...`, io);
    return new Promise((resolve) => {
        exec(`npm install ${PACKAGE_NAME}@latest --save`, {
            cwd: BACKEND_DIR,
            timeout: 120000, // 2 min max
            env: { ...process.env, npm_config_update_notifier: 'false' },
        }, (err) => {
            if (err) {
                log(`npm install failed: ${err.message}`, io);
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
}

/**
 * Main entry point — check and update cloakbrowser.
 * Always resolves with a result object, never rejects.
 * 
 * @returns {Promise<{updated: boolean, installed: string|null, latest: string|null, message: string}>}
 */
async function checkAndUpdate(io = null) {
    try {
        // Phase 1: Check installed version
        emitPhase(io, 'checking_update', 'Đang kiểm tra phiên bản CloakBrowser...');
        const installed = getInstalledVersion();
        if (!installed) {
            log('CloakBrowser not found in node_modules. Skipping update check.', io);
            emitPhase(io, 'ready', 'CloakBrowser chưa được cài đặt.');
            return { updated: false, installed: null, latest: null, message: 'Not installed' };
        }

        log(`Installed version: ${installed}. Checking npm registry...`, io);
        const latest = await fetchLatestVersion();

        if (!latest) {
            log('Could not reach npm registry. Skipping update.', io);
            emitPhase(io, 'ready', `Không kết nối được npm. Dùng v${installed}.`);
            return { updated: false, installed, latest: null, message: 'Registry unreachable' };
        }

        if (!isNewer(latest, installed)) {
            log(`Already up to date (v${installed}).`, io);
            emitPhase(io, 'ready', `CloakBrowser v${installed} — mới nhất.`);
            return { updated: false, installed, latest, message: 'Up to date' };
        }

        // Phase 2: Download & install update
        log(`Update available: v${installed} → v${latest}`, io);
        emitPhase(io, 'downloading_update', `Đang tải CloakBrowser v${latest} (hiện tại: v${installed})...`);

        const success = await installLatest(io);

        if (success) {
            const newVersion = getInstalledVersion();
            log(`✓ Updated successfully: v${installed} → v${newVersion || latest}`, io);
            emitPhase(io, 'ready', `✓ CloakBrowser cập nhật xong: v${newVersion || latest}`);
            return { updated: true, installed: newVersion || latest, latest, message: `Updated from v${installed} to v${newVersion || latest}` };
        } else {
            log(`Update failed. Continuing with v${installed}.`, io);
            emitPhase(io, 'ready', `⚠️ Cập nhật thất bại. Dùng v${installed}.`);
            return { updated: false, installed, latest, message: 'Update failed' };
        }
    } catch (err) {
        log(`Unexpected error: ${err.message}`, io);
        emitPhase(io, 'ready', `⚠️ Lỗi kiểm tra: ${err.message}`);
        return { updated: false, installed: null, latest: null, message: err.message };
    }
}

/**
 * Get current status without updating
 */
async function getStatus() {
    const installed = getInstalledVersion();
    const latest = await fetchLatestVersion();
    return {
        installed,
        latest,
        hasUpdate: isNewer(latest, installed),
    };
}

module.exports = { checkAndUpdate, getStatus, getInstalledVersion };
