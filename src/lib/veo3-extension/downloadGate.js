// Arm before clicking. A failed/cancelled download keeps the job waiting for
// another download from the same page, including a manual browser click.
function createDownloadGate(page, save, log = () => {}, isStopped = () => false) {
    let settled = false;
    let pendingDownloads = 0;
    let queue = Promise.resolve();
    let resolveResult, rejectResult;
    const result = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });
    result.catch(() => {});
    const cleanup = () => {
        clearInterval(stopTimer);
        page.off('download', onDownload);
        page.off('close', onClose);
    };
    const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectResult(new Error('DOWNLOAD_WAIT_STOPPED: Browser closed or worker stopped'));
    };
    const onClose = () => cancel();
    const onDownload = download => {
        pendingDownloads++;
        queue = queue.then(async () => {
            if (settled) return;
            try {
                const file = await save(download);
                if (settled) return;
                settled = true;
                cleanup();
                resolveResult(file);
            } catch (error) {
                if (!settled) log(`Chưa lưu được file: ${error.message}. Vẫn chờ tại bước Download; bạn có thể bấm tải lại.`);
            } finally {
                pendingDownloads--;
            }
        });
    };
    const stopTimer = setInterval(() => { if (isStopped()) cancel(); }, 500);
    page.on('download', onDownload);
    page.on('close', onClose);
    if (page.isClosed() || isStopped()) cancel();
    const canRetry = () => !settled && pendingDownloads === 0 && !isStopped() && !page.isClosed();
    const retryUntilSaved = async (attempt, retryDelay = 5000) => {
        let attempts = 0;
        while (!settled) {
            if (canRetry()) {
                attempts++;
                if (attempts > 1) log(`Chưa có file tải thành công. Thử bấm Download lần ${attempts}...`);
                try { await attempt(); }
                catch (error) {
                    if (!settled) log(`Bấm Download chưa thành công: ${error.message}. Sẽ tự thử lại.`);
                }
            }
            if (settled) break;
            let timer;
            try {
                await Promise.race([result, new Promise(resolve => { timer = setTimeout(resolve, retryDelay); })]);
            } finally { clearTimeout(timer); }
        }
        return result;
    };
    return { result, cancel, canRetry, retryUntilSaved };
}

module.exports = { createDownloadGate };
