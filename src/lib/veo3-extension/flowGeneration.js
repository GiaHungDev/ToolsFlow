function readGenerateState() {
    const visible = el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    if (Array.from(document.querySelectorAll('mat-icon.prompt-warning-sphere-icon')).some(el => visible(el) && el.textContent.trim() === 'info')) return 'NO_CREDITS';
    const button = Array.from(document.querySelectorAll('flow-generate-icon-button button.generate-icon-button, button.generate-icon-button[aria-label="Start generation"]')).find(visible);
    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? 'READY' : false;
}

async function assertGenerationCredits(page) {
    if (await page.evaluate(readGenerateState) === 'NO_CREDITS') throw new Error('FLOW_CREDITS_EXHAUSTED');
}

async function clickAngularGenerate(page, timeout = 35000) {
    const state = await page.waitForFunction(readGenerateState, null, { timeout });
    const status = await state.jsonValue();
    await state.dispose();
    if (status === 'NO_CREDITS') throw new Error('FLOW_CREDITS_EXHAUSTED');
    const button = page.locator('flow-generate-icon-button button.generate-icon-button:visible, button.generate-icon-button[aria-label="Start generation"]:visible');
    await button.waitFor({ state: 'visible', timeout });
    // Angular enables this only after prompt/media preparation. Never force it.
    try {
        await assertGenerationCredits(page);
        await button.click({ timeout });
    } catch (error) {
        await assertGenerationCredits(page);
        throw error;
    }
    await assertGenerationCredits(page);
}

async function trackAngularTiles(page) {
    await page.evaluate(() => {
        if (window.__harumiTileTracker) {
            window.__harumiTileTracker.scan();
            return;
        }
        let sequence = 0;
        const nodes = new WeakMap();
        const mediaIds = new Map();
        let trackedId = null;
        const resultText = tile => {
            const walker = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
            const parts = [];
            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.parentElement.closest('button, mat-icon, svg, flow-video-hotbar, flow-tile-hover-footer, .footer-title, flow-pending-tile .subtitle, [role="menu"], script, style')) continue;
                let hidden = false;
                for (let el = node.parentElement; el; el = el.parentElement) {
                    const style = getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true') { hidden = true; break; }
                    if (el === tile) break;
                }
                if (!hidden) parts.push(node.textContent);
            }
            return parts.join(' ').replace(/\s+/g, ' ').trim();
        };
        const set = (el, key, value) => {
            if (el.getAttribute(key) !== value) el.setAttribute(key, value);
        };
        const scan = () => {
            for (const tile of document.querySelectorAll('flow-grid-tile-container')) {
                const video = tile.querySelector('flow-video-tile video');
                const videoSrc = video?.getAttribute('src') || video?.querySelector('source[src]')?.getAttribute('src') || '';
                const thumbnail = tile.querySelector('flow-video-tile img.thumbnail');
                const src = videoSrc || thumbnail?.getAttribute('src') || '';
                const mediaKind = videoSrc ? 'video' : 'thumbnail';
                let mediaKey = src;
                // Empty pending tiles must not share the page URL as their identity.
                if (src) {
                    try { const url = new URL(src, location.href); mediaKey = url.origin + url.pathname; } catch {}
                }
                let record = nodes.get(tile);
                // Virtual scrolling can reuse an element for a different video.
                if (!record || (record.mediaKind === mediaKind && record.mediaKey && mediaKey && record.mediaKey !== mediaKey)) {
                    record = { id: mediaIds.get(mediaKey) || 'harumi-flow-' + (++sequence), mediaKey: '', mediaKind };
                    nodes.set(tile, record);
                }
                if (mediaKey) {
                    if (mediaIds.has(mediaKey)) record.id = mediaIds.get(mediaKey);
                    mediaIds.set(mediaKey, record.id);
                    record.mediaKey = mediaKey;
                    record.mediaKind = mediaKind;
                }
                const loading = tile.querySelector('.loading-percentage');
                const text = resultText(tile);
                const percent = text.match(/(\d+)\s*%/)?.[1];
                const pending = tile.querySelector('flow-pending-tile');
                const queued = /generating|queued|in queue|loading|đang tạo|đang chờ|đang tải/i.test(text);
                const complete = !pending && !loading && !percent && !!src;
                // A blank pending card is normal. Text replacing progress without
                // generated media is the failure result, including unknown wording.
                const failed = !percent && !queued && !src && text.length > 0;
                set(tile, 'data-tile-id', record.id);
                set(tile, 'data-harumi-flow-state', complete ? 'complete' : failed ? 'error' : 'generating');
                set(tile, 'data-harumi-flow-percent', percent || '0');
                set(tile, 'data-harumi-flow-error', failed ? text.slice(0, 500) : '');
            }
        };
        const observer = new MutationObserver(scan);
        observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['src', 'class', 'style', 'hidden', 'aria-hidden'] });
        const read = existingIds => {
            scan();
            if (existingIds.includes(trackedId)) trackedId = null;
            const tiles = Array.from(document.querySelectorAll('flow-grid-tile-container'));
            const tile = trackedId
                ? tiles.find(el => el.getAttribute('data-tile-id') === trackedId)
                : tiles.find(el => !existingIds.includes(el.getAttribute('data-tile-id')));
            // Do not switch to another job when the tracked tile temporarily disappears.
            if (!tile) return { state: 'waiting', tileCount: 0 };
            trackedId = tile.getAttribute('data-tile-id');
            const rect = (tile.querySelector('video, img.thumbnail') || tile).getBoundingClientRect();
            const text = tile.getAttribute('data-harumi-flow-error') || '';
            let errorReason = 'tile_generation_error';
            if (/third.party|bên thứ ba/i.test(text)) errorReason = 'third_party_content_violation';
            else if (/policy|chính sách|vi phạm/i.test(text)) errorReason = 'prompt_policy_violation';
            else if (/unusual activity|hoạt động bất thường/i.test(text)) errorReason = 'unusual_activity';
            else if (/quota|limit|hạn mức|giới hạn/i.test(text)) errorReason = 'model_limit_exceeded';
            return {
                state: tile.getAttribute('data-harumi-flow-state'),
                tileId: trackedId,
                percent: Number(tile.getAttribute('data-harumi-flow-percent') || 0),
                text, errorReason,
                coords: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
            };
        };
        window.__harumiTileTracker = { scan, observer, read };
        scan();
    });
}

async function flowControlPoint(control, timeout) {
    await control.waitFor({ state: 'visible', timeout });
    await control.scrollIntoViewIfNeeded({ timeout });
    if (!await control.isEnabled() || await control.getAttribute('aria-disabled') === 'true') {
        throw new Error('DOWNLOAD_CONTROL_DISABLED');
    }
    const point = await control.evaluate(el => {
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        return r.width > 0 && r.height > 0 && el.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    });
    if (!point) throw new Error('DOWNLOAD_CONTROL_OBSCURED');
    return point;
}

const downloadMousePositions = new WeakMap();

async function moveDownloadMouse(page, x, y, shouldMove = () => true) {
    // CloakBrowser ignores options on mouse.move. Pace actual pointer movement
    // through its original mouse method and keep its cursor state synchronized.
    if (page._ensureCursorInit) await page._ensureCursorInit();
    const cursor = page._humanCursor || downloadMousePositions.get(page) || { x: 0, y: 0 };
    const start = { x: cursor.x, y: cursor.y };
    const distance = Math.hypot(x - start.x, y - start.y);
    if (distance < 1) return;
    const duration = Math.max(250, Math.min(2000, distance / 300 * 1000));
    const steps = Math.ceil(duration / 20);
    const move = page._humanOriginals?.mouseMove || page.mouse.move.bind(page.mouse);
    for (let step = 1; step <= steps; step++) {
        if (!shouldMove()) return;
        const t = step / steps;
        const progress = t * t * (3 - 2 * t);
        const point = { x: start.x + (x - start.x) * progress, y: start.y + (y - start.y) * progress };
        await move(point.x, point.y);
        cursor.x = point.x;
        cursor.y = point.y;
        downloadMousePositions.set(page, cursor);
        if (step < steps) await new Promise(resolve => setTimeout(resolve, duration / steps));
    }
}

async function clickFlowControl(page, control, timeout, shouldClick = () => true) {
    const point = await flowControlPoint(control, timeout);
    await moveDownloadMouse(page, point.x, point.y, shouldClick);
    if (!shouldClick()) return;
    await page.mouse.click(point.x, point.y, { human_config: { idle_between_actions: false } });
}

function downloadQualityItem(page, quality) {
    // Material menu content may not have a role="menu" ancestor.
    // Match the actionable button, never a container containing all qualities.
    const buttons = page.locator('[role="menu"]:visible button[role="menuitem"]:visible, .mat-mdc-menu-content:visible button[role="menuitem"]:visible');
    return buttons.filter({
        has: page.locator('.label').filter({ hasText: new RegExp('^' + quality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }),
    }).or(buttons.filter({ hasNot: page.locator('.label'), hasText: new RegExp('^\\s*' + quality.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\s|$)') }));
}

async function clickAngularDownloadQuality(page, quality, timeout = 10000, shouldClick = () => true) {
    const item = downloadQualityItem(page, quality);
    await item.waitFor({ state: 'visible', timeout });
    if (!await item.isEnabled() || await item.getAttribute('aria-disabled') === 'true') {
        throw new Error('DOWNLOAD_QUALITY_UNAVAILABLE: ' + quality);
    }
    await enterDownloadSubmenu(page, item, timeout, shouldClick);
    await clickFlowControl(page, item, timeout, shouldClick);
}

function downloadMenuItem(page) {
    const name = /^(Download|Tải xuống)$/i;
    return page.locator('[role="menu"]:visible [role="menuitem"]:visible, .mat-mdc-menu-content:visible button[role="menuitem"]:visible')
        .filter({ has: page.locator('.label').filter({ hasText: name }) })
        .or(page.getByRole('menuitem', { name }));
}

async function enterDownloadSubmenu(page, item, timeout, shouldMove) {
    const parent = downloadMenuItem(page);
    if (!await parent.isVisible()) return;
    const parentRect = await parent.boundingBox();
    const submenu = await item.evaluate(el => {
        const menu = el.closest('.mat-mdc-menu-content, [role="menu"]');
        if (!menu) return null;
        const r = menu.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (!parentRect || !submenu) return;
    const cursor = page._humanCursor || downloadMousePositions.get(page);
    if (cursor && cursor.x > submenu.x && cursor.x < submenu.x + submenu.width &&
        cursor.y > submenu.y && cursor.y < submenu.y + submenu.height) return;
    // Cross horizontally where the parent row and submenu overlap vertically.
    // Going diagonally toward 720p/1080p leaves the parent and closes the menu.
    const top = Math.max(parentRect.y, submenu.y) + 8;
    const bottom = Math.min(parentRect.y + parentRect.height, submenu.y + submenu.height) - 8;
    if (top > bottom) return;
    const crossingY = Math.max(top, Math.min(bottom, parentRect.y + parentRect.height / 2));
    const target = await flowControlPoint(item, timeout);
    await moveDownloadMouse(page, parentRect.x + parentRect.width / 2, crossingY, shouldMove);
    await moveDownloadMouse(page, target.x, crossingY, shouldMove);
    // clickFlowControl now moves vertically inside the submenu to the quality.
}

async function clickAngularVideoDownload(page, tileId, quality, timeout = 10000, log = () => {}, shouldClick = () => true) {
    if (!shouldClick()) return;
    if (!/^harumi-flow-\d+$/.test(tileId || '')) throw new Error('DOWNLOAD_TARGET_MISSING');
    const tile = page.locator(`flow-grid-tile-container[data-tile-id="${tileId}"]`);
    await tile.waitFor({ state: 'visible', timeout });
    await tile.scrollIntoViewIfNeeded({ timeout });
    if (await tile.getAttribute('data-harumi-flow-state') !== 'complete') {
        throw new Error('DOWNLOAD_TARGET_NOT_COMPLETE');
    }
    if (!shouldClick()) return;
    // A missed click often leaves the quality submenu open. Retry that button
    // directly instead of closing the menu and starting over.
    if (await downloadQualityItem(page, quality).isVisible()) {
        log(`[STEP 9f] Retrying visible quality button: ${quality}`);
        await clickAngularDownloadQuality(page, quality, timeout, shouldClick);
        return;
    }
    if (!shouldClick()) return;
    await page.keyboard.press('Escape');
    // Reveal the hotbar without clicking the video or invoking patched hover().
    const rect = await tile.boundingBox();
    if (!rect) throw new Error('DOWNLOAD_TARGET_MISSING');
    if (!shouldClick()) return;
    await moveDownloadMouse(page, rect.x + rect.width / 2, rect.y + rect.height / 2, shouldClick);
    log('[STEP 9f] Opening More options for tracked video...');
    await clickFlowControl(page, tile.getByRole('button', { name: /^(More options|Tùy chọn khác|Tuỳ chọn khác)$/i }), timeout, shouldClick);
    if (!shouldClick()) return;
    const downloadItem = downloadMenuItem(page);
    await downloadItem.waitFor({ state: 'visible', timeout });
    log('[STEP 9f] Clicking Download to open quality submenu...');
    await clickFlowControl(page, downloadItem, timeout, shouldClick);
    if (!shouldClick()) return;
    log(`[STEP 9f] Clicking quality button: ${quality}`);
    await clickAngularDownloadQuality(page, quality, timeout, shouldClick);
}

module.exports = { clickAngularGenerate, assertGenerationCredits, trackAngularTiles, clickAngularDownloadQuality, clickAngularVideoDownload };
