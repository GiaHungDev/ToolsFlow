async function waitForBrowserLaunch(promise, timeout, message, isCancelled) {
    let expired = false;
    let timer;
    const guarded = promise.then(async context => {
        if (expired || isCancelled()) {
            await context.close().catch(() => {});
            throw new Error('AUTOMATION_STOPPED');
        }
        return context;
    });
    try {
        return await Promise.race([
            guarded,
            new Promise((_, reject) => {
                timer = setTimeout(() => { expired = true; reject(new Error(message)); }, timeout);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { waitForBrowserLaunch };
