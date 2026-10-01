/**
 * Centralized Veo3 Config Manager
 * Single source of truth for all Veo3 settings.
 * Persists to veo3_config.json, serves live config to workers.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    browser: 'brave',
    visibility: 'hidden',
    headless: true,
    workerCount: 1,
    imgModel: 'Nano Banana 2 Lite',
    videoModel: 'Veo 3.1 - Lite [Lower Priority]',
    imgQuality: '1K',
    videoQuality: '720p',
    returnSilent: true,
    videoRatio: '16:9',
    videoCount: '1',
    imgRatio: '16:9',
    imgCount: '1',
    outputPath: '',
    useProxy: false,
    mapping: {},
};

class ConfigManager {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.configPath = path.join(dataDir, 'veo3_config.json');
        this.config = { ...DEFAULTS };
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                this.config = { ...DEFAULTS, ...raw };
            } else {
                // Migrate from legacy thread_mapping.json if it exists
                const legacyPath = path.join(this.dataDir, 'thread_mapping.json');
                if (fs.existsSync(legacyPath)) {
                    try {
                        const mapping = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
                        this.config.mapping = mapping;
                        console.log('[ConfigManager] Migrated mapping from thread_mapping.json');
                    } catch (e) { /* ignore parse errors */ }
                }
                // Save initial config
                this.saveConfig(this.config);
            }
        } catch (e) {
            console.error('[ConfigManager] Error loading config:', e.message);
            this.config = { ...DEFAULTS };
        }
    }

    getConfig() {
        return { ...this.config };
    }

    saveConfig(newConfig) {
        // Only allow known keys, merge with current
        const merged = { ...this.config };
        for (const key of Object.keys(DEFAULTS)) {
            if (newConfig[key] !== undefined) {
                merged[key] = newConfig[key];
            }
        }
        this.config = merged;
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
        } catch (e) {
            console.error('[ConfigManager] Error saving config:', e.message);
            throw e;
        }
        return this.getConfig();
    }

    // Convenience getters for worker
    get browser() { return this.config.browser; }
    get visibility() { return this.config.visibility; }
    get headless() { return this.config.headless !== false; }
    get workerCount() { return this.config.workerCount; }
    get imgModel() { return this.config.imgModel; }
    get videoModel() { return this.config.videoModel; }
    get imgQuality() { return this.config.imgQuality; }
    get videoQuality() { return this.config.videoQuality; }
    get returnSilent() { return this.config.returnSilent !== false; }
    get mapping() { return this.config.mapping || {}; }
}

module.exports = ConfigManager;
