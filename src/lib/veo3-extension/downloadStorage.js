const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const defaultDirectory = (projectName = 'Veo3_Downloads', baseDirectory = '') => {
    let safeName = String(projectName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
    if (!safeName) safeName = 'Veo3_Downloads';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)) safeName = `_${safeName}`;
    return path.resolve(baseDirectory?.trim() || (process.platform === 'win32' ? 'C:\\' : os.tmpdir()), safeName);
};

async function checkWritableDirectory(directory) {
    await fs.mkdir(directory, { recursive: true });
    const probe = path.join(directory, `.harumi-write-check-${randomUUID()}`);
    const handle = await fs.open(probe, 'wx');
    try { await handle.writeFile('check'); }
    finally {
        await handle.close();
        await fs.unlink(probe);
    }
    return directory;
}

async function prepareOutputDirectory(requested, log = () => {}, fallback = defaultDirectory()) {
    const selected = requested?.trim() || '';
    const directory = path.resolve(selected || fallback);
    try {
        return await checkWritableDirectory(directory);
    } catch (error) {
        if (directory === path.resolve(fallback)) throw error;
        await checkWritableDirectory(fallback);
        log(`Không ghi được vào ${directory} (${error.code || error.message}). Chuyển nơi lưu sang: ${fallback}`);
        return fallback;
    }
}

async function saveDownloadedFile(download, directory, filename, log = () => {}, fallback = defaultDirectory()) {
    let destination = path.join(directory, filename);
    try {
        await download.saveAs(destination);
    } catch (error) {
        // Playwright wraps filesystem errors in its message, often without error.code.
        const denied = /\b(EPERM|EACCES|EROFS)\b/.test(`${error.code || ''} ${error.message}`);
        if (!denied || path.resolve(directory) === path.resolve(fallback)) throw error;
        await checkWritableDirectory(fallback);
        destination = path.join(fallback, filename);
        log(`Không thể lưu file tại ${directory}. Lưu lại file đã tải vào: ${destination}`);
        await download.saveAs(destination);
    }
    const saved = await fs.stat(destination);
    if (!saved.isFile() || saved.size === 0) throw new Error('DOWNLOAD_EMPTY_FILE: Download did not produce a valid file');
    return destination;
}

module.exports = { defaultDirectory, prepareOutputDirectory, saveDownloadedFile };
