/**
 * BrowserPool - Simple browser registry for lifecycle management.
 *
 * Architecture (matches veo3auto):
 *   - 1 account = 1 profile = 1 worker = 1 browser
 *   - Each worker launches its own browser independently
 *   - BrowserPool only tracks browsers for cleanup on stop
 *   - No sharing, no CDP windows, no cookie sync
 */
const path = require('path');
const fs = require('fs');

class BrowserPool {
    constructor(io) {
        this.io = io;
        // Map: workerId → { browser, profilePath }
        this.pool = new Map();
    }

    log(msg) {
        const message = `[BrowserPool] ${msg}`;
        console.log(message);
        this.io.emit('log', message);
    }

    /**
     * Register a browser launched by a worker.
     */
    register(workerId, browser, profilePath) {
        this.pool.set(String(workerId), { browser, profilePath });
        // Playwright BrowserContext emits 'close', Puppeteer Browser emits 'disconnected'
        const event = typeof browser.isConnected === 'function' ? 'disconnected' : 'close';
        browser.on(event, () => {
            this.pool.delete(String(workerId));
        });
    }

    /**
     * Close a specific worker's browser.
     */
    async closeBrowser(workerId) {
        const id = String(workerId);
        const entry = this.pool.get(id);
        if (!entry) return;

        try {
            if (entry.browser) {
                // Playwright BrowserContext does not have isConnected()
                if (typeof entry.browser.isConnected === 'function') {
                    if (entry.browser.isConnected()) await entry.browser.close();
                } else {
                    await entry.browser.close();
                }
            }
        } catch (e) {
            this.log(`Error closing browser for worker ${id}: ${e.message}`);
        }
        this.pool.delete(id);
        this.log(`Browser for worker ${id} closed.`);
    }

    /**
     * Close ALL browsers. Called on automation stop.
     */
    async closeAll() {
        const ids = Array.from(this.pool.keys());
        for (const id of ids) {
            await this.closeBrowser(id);
        }
        this.log(`All browsers closed (${ids.length} workers).`);
    }

    /**
     * Diagnostic: pool status for frontend display.
     */
    getAllWindowInfo() {
        const result = [];
        for (const [workerId, entry] of this.pool) {
            const connected = typeof entry.browser?.isConnected === 'function' ? entry.browser.isConnected() : (entry.browser !== null && entry.browser !== undefined);
            result.push({
                workerId,
                connected: connected || false,
            });
        }
        return result;
    }

    // ─────────────────────────────────────────────────────────
    // Static utility methods (used by worker before launch)
    // ─────────────────────────────────────────────────────────

    /**
     * Remove known unsafe extensions that inject content scripts and trigger
     * Google's anomaly detection.
     */
    static removeUnsafeExtensions(profilePath, logger) {
        const extDir = path.join(profilePath, 'Default', 'Extensions');
        if (!fs.existsSync(extDir)) return;

        const unsafeIds = [
            'ihcjicgdanjaechkgeegckofjjedodee',  // Malwarebytes Browser Guard
            'aohghmighlieiainnegkcijnfilokake',  // Google Drive (Application Launcher)
            'lmjegmlicamnimmfhcmpkclmigmmcbeh',  // Google Drive (alternate ID)
            'fheoggkfdfchfphceeifdbepaojcggo',   // McAfee WebAdvisor
        ];

        for (const id of unsafeIds) {
            const extPath = path.join(extDir, id);
            if (fs.existsSync(extPath)) {
                try {
                    fs.rmSync(extPath, { recursive: true, force: true });
                    if (logger) logger(`[Security] Removed unsafe extension: ${id}`);
                } catch (e) {
                    if (logger) logger(`[Security] Could not remove extension ${id}: ${e.message}`);
                }
            }
        }

        // Also remove extension entries from Preferences
        try {
            const prefsPath = path.join(profilePath, 'Default', 'Preferences');
            if (fs.existsSync(prefsPath)) {
                const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                if (prefs.extensions && prefs.extensions.settings) {
                    let removed = 0;
                    for (const id of unsafeIds) {
                        if (prefs.extensions.settings[id]) {
                            delete prefs.extensions.settings[id];
                            removed++;
                        }
                    }
                    if (removed > 0) {
                        fs.writeFileSync(prefsPath, JSON.stringify(prefs));
                        if (logger) logger(`[Security] Purged ${removed} extension entries from Preferences`);
                    }
                }
            }
        } catch (e) {
            // Non-fatal
        }
    }

    /**
     * Inject Brave/Chrome preferences for Google Labs compatibility.
     */
    static injectPreferences(profilePath) {
        try {
            const setPrefs = (prefs) => {
                if (!prefs.profile) prefs.profile = {};
                prefs.profile.cookie_controls_mode = 2; // 2 = Block third-party cookies always
                prefs.profile.block_third_party_cookies = true; // Google recommends blocking for Flow unusual activity fix
                prefs.enable_do_not_track = true; // User-tested: works with Google login + Flow

                if (!prefs.privacy_sandbox) prefs.privacy_sandbox = {};
                prefs.privacy_sandbox.related_website_sets_enabled = false;
                prefs.privacy_sandbox.first_party_sets_enabled = false;

                if (!prefs.privacy) prefs.privacy = {};
                if (!prefs.privacy.tracking) prefs.privacy.tracking = {};
                // Let the browser handle tracking protection naturally

                if (!prefs.enhanced_tracking_prevention) prefs.enhanced_tracking_prevention = {};
                prefs.enhanced_tracking_prevention.enabled = false;

                // CRITICAL: Wipe proxy from preferences so that if user disables proxy, it doesn't linger
                if (prefs.proxy) {
                    delete prefs.proxy;
                }

                // Brave-specific
                if (!prefs.brave) prefs.brave = {};
                if (!prefs.brave.p3a) prefs.brave.p3a = {};
                prefs.brave.p3a.notice_acknowledged = true;
                prefs.brave.p3a.enabled = false;

                if (!prefs.brave.shields) prefs.brave.shields = {};
                prefs.brave.shields.advanced_view_enabled = false;
                if (!prefs.brave.shields.default) prefs.brave.shields.default = {};
                prefs.brave.shields.default.ads = 0;
                prefs.brave.shields.default.trackers = 0;
                prefs.brave.shields.default.httpUpgradable = 0;
                prefs.brave.shields.default.noScript = 0;
                prefs.brave.shields.default.fingerprinting = 0;
                prefs.brave.shields.default.cookies = 0;

                prefs.brave.fingerprinting_v2_enabled = false;

                if (!prefs.brave.de_amp) prefs.brave.de_amp = {};
                prefs.brave.de_amp.enabled = false;

                // Disable shields for Google domains
                if (!prefs.profile.content_settings) prefs.profile.content_settings = {};
                if (!prefs.profile.content_settings.exceptions) prefs.profile.content_settings.exceptions = {};
                if (!prefs.profile.content_settings.exceptions.braveShields) prefs.profile.content_settings.exceptions.braveShields = {};
                prefs.profile.content_settings.exceptions.braveShields['[*.]google.com,*'] = { setting: 1 };
                prefs.profile.content_settings.exceptions.braveShields['[*.]googleapis.com,*'] = { setting: 1 };
                prefs.profile.content_settings.exceptions.braveShields['[*.]gstatic.com,*'] = { setting: 1 };
                prefs.profile.content_settings.exceptions.braveShields['[*.]labs.google,*'] = { setting: 1 };
                prefs.profile.content_settings.exceptions.braveShields['[*.]flow.google.com,*'] = { setting: 1 };
                prefs.profile.content_settings.exceptions.braveShields['[*.]recaptcha.net,*'] = { setting: 1 };

                // Disable session restore
                if (!prefs.session) prefs.session = {};
                prefs.session.restore_on_startup = 1; // 1 = New Tab page (NOT session restore)
                prefs.session.startup_urls = [];
                prefs.profile.exit_type = 'Normal';
                prefs.profile.exited_cleanly = true;

                // Hide download bubble/bar — prevents download UI from interfering with automation
                if (!prefs.download_bubble) prefs.download_bubble = {};
                prefs.download_bubble.partial_view_enabled = false;
                if (!prefs.download) prefs.download = {};
                prefs.download.prompt_for_download = false;

                return prefs;
            };

            const prefsPath = path.join(profilePath, 'Default', 'Preferences');
            if (fs.existsSync(prefsPath)) {
                const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
                fs.writeFileSync(prefsPath, JSON.stringify(setPrefs(prefs)));
            } else {
                fs.mkdirSync(path.join(profilePath, 'Default'), { recursive: true });
                fs.writeFileSync(prefsPath, JSON.stringify(setPrefs({})));
            }

            // Delete session restore files
            const sessionsDir = path.join(profilePath, 'Default', 'Sessions');
            if (fs.existsSync(sessionsDir)) {
                try { fs.rmSync(sessionsDir, { recursive: true, force: true }); } catch (e) { }
            }
            for (const sf of ['Last Session', 'Current Session', 'Last Tabs', 'Current Tabs']) {
                const fp = path.join(profilePath, 'Default', sf);
                try { if (fs.existsSync(fp)) fs.rmSync(fp); } catch (e) { }
            }
        } catch (e) {
            // Non-fatal
        }
    }

    /**
     * Clean stale lock files from a profile directory.
     */
    static cleanStaleLocks(profilePath) {
        for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
            const target = path.join(profilePath, f);
            try { if (fs.existsSync(target)) fs.rmSync(target); } catch (e) { }
        }
    }

}

module.exports = BrowserPool;
