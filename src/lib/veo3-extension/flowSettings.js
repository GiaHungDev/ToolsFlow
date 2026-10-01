// Angular Flow settings. Select by stable labels and verify radio state.
async function setupFlowSettings(page, job, config, log) {
    const panel = page.locator('.settings-content:visible');
    if (!await panel.isVisible()) {
        await page.locator('button.settings-trigger-button:visible').click({ timeout: 10000 });
    }
    await panel.waitFor({ state: 'visible', timeout: 10000 });

    const choose = async (labels, values) => {
        const groups = labels.map(label => `flow-toggles[aria-label=${JSON.stringify(label)}]`).join(', ');
        const group = panel.locator(groups);
        const options = values.map(value => `button[role="radio"]:has(.toggle-text:text-is(${JSON.stringify(String(value))}))`).join(', ');
        const button = group.locator(options);
        await button.waitFor({ state: 'visible', timeout: 5000 });
        if (await button.getAttribute('aria-checked') !== 'true') await button.click({ timeout: 5000 });
        await group.locator(options.split(', ').map(s => s + '[aria-checked="true"]').join(', '))
            .waitFor({ state: 'visible', timeout: 5000 });
        log('[STEP 6] Selected ' + labels[0] + ': ' + values[0]);
    };

    const video = ['T2V', 'I2V', 'IN2V'].includes(job.TYPE_VIDEO);
    const settings = (video ? config.videoSettings : config.imgSettings) || {};
    await choose(['Chế độ', 'Mode'], video ? ['Video'] : ['Hình ảnh', 'Image', 'Images']);
    if (video) {
        // Text-only and reference-image jobs use the Ingredients composer.
        // Frames is reserved for explicit start-frame I2V jobs.
        await choose(['Loại video', 'Video type'], job.TYPE_VIDEO === 'I2V'
            ? ['Khung hình', 'Frames'] : ['Thành phần', 'Ingredients']);
    }

    // Model changes can change the available duration and resolution options.
    const targetModel = settings.model || (video ? config.videoModel : config.imgModel);
    if (targetModel) {
        const modelButton = panel.locator('button:has(.model-select-trigger-content)');
        const modelLabel = modelButton.locator('.model-select-trigger-content');
        const currentModel = async () => modelLabel.evaluate(el => {
            const copy = el.cloneNode(true);
            copy.querySelectorAll('mat-icon').forEach(icon => icon.remove());
            return copy.textContent.replace(/\s+/g, ' ').trim();
        });
        if (await currentModel() !== targetModel) {
            await modelButton.click({ timeout: 5000 });
            const escaped = targetModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const option = page.locator('[role="menuitem"]:visible, [role="menuitemradio"]:visible, [role="option"]:visible')
                .filter({ has: page.locator('.label').filter({ hasText: new RegExp('^\\s*' + escaped + '\\s*$') }) });
            try {
                await option.waitFor({ state: 'visible', timeout: 5000 });
            } catch {
                throw new Error('FLOW_MODEL_NOT_FOUND: requested "' + targetModel + '" is unavailable.');
            }
            await option.click({ timeout: 5000 });
            try {
                await page.waitForFunction(({ target }) => {
                    const label = document.querySelector('.settings-content .model-select-trigger-content');
                    if (!label) return false;
                    const copy = label.cloneNode(true);
                    copy.querySelectorAll('mat-icon').forEach(icon => icon.remove());
                    return copy.textContent.replace(/\s+/g, ' ').trim() === target;
                }, { target: targetModel }, { timeout: 5000 });
            } catch {
                throw new Error('FLOW_MODEL_VERIFY_FAILED: ' + targetModel);
            }
        }
    }

    await choose(['Tỷ lệ khung hình', 'Aspect ratio'], [settings.ratio || (video ? config.videoRatio : config.imgRatio) || '16:9']);
    // Download/upscale quality (videoQuality) is separate from generation resolution.
    const resolution = settings.generationResolution || config.generationResolution;
    if (video && resolution) await choose(['Độ phân giải video', 'Video resolution'], [resolution]);
    if (video) {
        const duration = String(job.DURATION || settings.duration || config.videoDuration || '8s').match(/^\d+/)?.[0];
        if (!duration) throw new Error('FLOW_INVALID_DURATION');
        await choose(['Thời lượng video', 'Video duration'], [duration + ' giây', duration + 's']);
    }
    const count = String(settings.count || (video ? config.videoCount : config.imgCount) || 1).replace(/[xX]/g, '').trim();
    // Output group labels vary between Flow versions. Match the visible toggle's
    // own text within this settings panel instead of relying on its group label.
    const countText = new RegExp('^(?:x\\s*' + count + '|' + count + '\\s*x)$', 'i');
    const countButton = panel.locator('button:visible').filter({
        has: page.locator('.toggle-text').filter({ hasText: countText }),
    });
    await countButton.waitFor({ state: 'visible', timeout: 5000 });
    const selectedCount = countButton.and(panel.locator(
        'button[aria-checked="true"], mat-button-toggle.mat-button-toggle-checked button:not([aria-checked])'
    ));
    if (!await selectedCount.count()) await countButton.click({ timeout: 5000 });
    await selectedCount.waitFor({ state: 'visible', timeout: 5000 });
    log('[STEP 6] Selected output count: x' + count);
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
    log('[STEP 6] Angular Flow settings verified.');
}

const initialSummaries = new WeakMap();

async function setupFlowSettingsOnce(page, job, config, log) {
    const initialSummary = initialSummaries.get(page);
    if (!initialSummaries.has(page)) {
        await setupFlowSettings(page, job, config, log);
        initialSummaries.set(page, null);
    }

    const summary = page.locator('.settings-summary:visible').first();
    try {
        await summary.waitFor({ state: 'visible', timeout: 10000 });
        const current = (await summary.textContent()).replace(/\s+/g, ' ').trim();
        if (!current) throw new Error('Settings summary is empty');
        if (initialSummary && current !== initialSummary) {
            throw new Error(`Expected "${initialSummary}", found "${current}"`);
        }
        initialSummaries.set(page, current);
        log(`[STEP 6] Đã kiểm tra settings-summary: ${current}. Giữ cấu hình ban đầu.`);
    } catch (error) {
        throw new Error(`FLOW_SETTINGS_SUMMARY_MISMATCH: ${error.message}`);
    }
}

module.exports = { setupFlowSettings, setupFlowSettingsOnce };
