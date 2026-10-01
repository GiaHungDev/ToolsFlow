async function findAngularUploadButton(page) {
    const button = page.locator('button:visible, [role="button"]:visible').filter({
        has: page.locator('mat-icon.add-menu-icon').filter({ hasText: /^\s*add\s*$/ }),
    });
    if (!await button.count()) return null;
    // Do not guess if multiple visible upload controls are present.
    if (await button.count() !== 1) throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Multiple visible Angular add buttons');
    if (!await button.isEnabled()) return null;
    await button.scrollIntoViewIfNeeded();
    const rect = await button.boundingBox();
    return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
}

// Runs in the page; resolve the current composer again after Angular rerenders.
function readPromptMedia(before = null) {
    const visible = el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const prosemirror = Array.from(document.querySelectorAll('.prosemirror-editor .ProseMirror[contenteditable="true"]')).filter(visible);
    const editors = prosemirror.length
        ? prosemirror
        : Array.from(document.querySelectorAll('.ql-editor, textarea, [contenteditable="true"]'));
    for (const editor of editors) {
        if (!visible(editor)) continue;
        if (editor.disabled || editor.readOnly || editor.getAttribute('contenteditable') === 'false') continue;
        if (editor.closest('[role="dialog"], [role="menu"], .cdk-overlay-pane')) continue;
        const panel = editor.closest('div.sc-4e96504a-0, div.sc-1fffc27c-4');
        if (panel?.querySelector('[aria-label="Resize agent panel"], [aria-label="Đổi kích thước bảng điều khiển tác nhân"]')) continue;
        if (prosemirror.length === 1 && (before === 'kind' || before === 'editor')) {
            if (before === 'kind') return 'angular';
            document.querySelectorAll('[data-harumi-prompt-editor]').forEach(el => el.removeAttribute('data-harumi-prompt-editor'));
            editor.setAttribute('data-harumi-prompt-editor', 'true');
            return true;
        }
        if (editor.matches('[data-slate-editor="true"][role="textbox"]')) {
            if (before === 'kind') return 'slate';
            continue;
        }
        for (let root = editor.parentElement; root && root !== document.body; root = root.parentElement) {
            if (root.querySelector('button.detail-add-to-prompt-btn')) break;
            // Text-only jobs may not show the media add button. Identify the
            // composer by its generate control as well, without requiring uploads.
            if (!root.querySelector('mat-icon.add-menu-icon, flow-generate-icon-button, button.generate-icon-button')) continue;
            // A page-level ancestor can contain both a search/chat input and the
            // real composer. Do not mistake that shared ancestor for an editor.
            const otherEditors = Array.from(root.querySelectorAll('textarea, [contenteditable="true"]'))
                .filter(other => other !== editor && !editor.contains(other) && !other.contains(editor) && visible(other));
            if (otherEditors.length) continue;
            if (before === 'ingredientSnapshot') {
                return Array.from(root.querySelectorAll('flow-image-ingredient-chip img')).map(img => img.getAttribute('src') || '');
            }
            if (before === 'ingredients' || before?.ingredientsBelow !== undefined) {
                document.querySelectorAll('[data-harumi-ingredient-root]').forEach(el => el.removeAttribute('data-harumi-ingredient-root'));
                root.setAttribute('data-harumi-ingredient-root', 'true');
                const count = root.querySelectorAll('flow-image-ingredient-chip').length;
                return before === 'ingredients' ? count : count < before.ingredientsBelow;
            }
            if (before === 'kind') return 'angular';
            if (before === 'editor') {
                document.querySelectorAll('[data-harumi-prompt-editor]').forEach(el => el.removeAttribute('data-harumi-prompt-editor'));
                editor.setAttribute('data-harumi-prompt-editor', 'true');
                return true;
            }
            const count = Array.from(root.querySelectorAll('img, canvas, video')).filter(el => {
                const r = el.getBoundingClientRect();
                return visible(el) && r.width > 20 && r.height > 20
                    && !el.closest('[role="dialog"], [role="menu"], .cdk-overlay-pane');
            }).length;
            return before === null ? count : count > before;
        }
    }
    return before === null ? null : false;
}

async function addAngularMediaToPrompt(page, timeout = 35000, log = () => {}) {
    const before = await page.evaluate(readPromptMedia);
    if (before === null) throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Angular prompt container not found; need composer HTML');
    const button = page.locator('button.detail-add-to-prompt-btn:visible');
    log('[AttachFlow] Waiting for Add to prompt to be enabled...');
    await button.waitFor({ state: 'visible', timeout });
    await button.scrollIntoViewIfNeeded();
    // Use the actual button center, avoiding the custom locator click wrapper.
    const ready = await page.waitForFunction(() => {
        const buttons = Array.from(document.querySelectorAll('button.detail-add-to-prompt-btn')).filter(b => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden';
        });
        if (buttons.length !== 1) return false;
        const b = buttons[0];
        if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
        const r = b.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (!b.contains(document.elementFromPoint(x, y))) return false;
        return { x, y };
    }, null, { timeout });
    const point = await ready.jsonValue();
    await ready.dispose();
    log('[AttachFlow] Clicking Add to prompt at ' + Math.round(point.x) + ', ' + Math.round(point.y));
    await page.mouse.click(point.x, point.y);
    log('[AttachFlow] Mouse click sent; waiting for new media in prompt...');
    try {
        await page.waitForFunction(readPromptMedia, before, { timeout });
    } catch (error) {
        const current = await page.evaluate(readPromptMedia);
        const enabled = await button.isEnabled().catch(() => null);
        throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Add to prompt clicked but attachment not confirmed (before=' + before + ', current=' + current + ', buttonEnabled=' + enabled + '). ' + error.message);
    }
}

async function selectAngularImagesTab(page, timeout = 35000, log = () => {}) {
    const tabs = page.locator('mat-list-item[role="tab"]:visible');
    const tab = tabs.filter({
        has: page.locator('mat-icon').filter({ hasText: /^\s*image\s*$/ }),
    }).or(tabs.filter({
        has: page.locator('.side-nav-list-item-title').filter({ hasText: /^\s*(?:Images|Hình ảnh|Ảnh)\s*$/i }),
    }));
    try {
        await tab.waitFor({ state: 'visible', timeout });
        await tab.scrollIntoViewIfNeeded({ timeout });
        if (await tab.getAttribute('aria-selected') !== 'true') {
            await tab.click({ timeout });
        }
        const selected = await page.waitForFunction(() => {
            const tabs = Array.from(document.querySelectorAll('mat-list-item[role="tab"]')).filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden'
                    && (Array.from(el.querySelectorAll('mat-icon')).some(icon => icon.textContent.trim() === 'image')
                        || /^\s*(?:Images|Hình ảnh|Ảnh)\s*$/i.test(el.querySelector('.side-nav-list-item-title')?.textContent || ''));
            });
            return tabs.length === 1 && tabs[0].getAttribute('aria-selected') === 'true'
                && tabs[0].getAttribute('aria-disabled') !== 'true';
        }, null, { timeout });
        await selected.dispose();
        log('[Upload] Images tab selected; continuing image upload.');
    } catch (error) {
        throw new Error('IMAGE_UPLOAD_VERIFY_FAILED: Could not select Images tab before upload. ' + error.message);
    }
}

async function clickUploadMedia(page, timeout = 5000) {
    const uploadName = /(?:^|\s)(?:Upload media|Upload image|Upload|Tải hình ảnh lên|Tải nội dung nghe nhìn lên|Tải lên)\s*$/i;
    const legacyButton = page.locator('button:visible, [role="button"]:visible, [role="menuitem"]:visible, label[for]:visible')
        .filter({ hasText: uploadName });
    const button = page.locator('button.sidebar-upload-btn:visible, button[mattooltip="Upload media"]:visible')
        .or(legacyButton);
    // Never choose a generic div/span or an arbitrary last match.
    await button.waitFor({ state: 'visible', timeout });
    await button.scrollIntoViewIfNeeded({ timeout });
    await button.click({ timeout });
}

async function waitForUploadChooser(page, click, timeout = 10000) {
    let timer;
    let resolveChooser;
    const chooser = new Promise(resolve => { resolveChooser = resolve; });
    const onChooser = fileChooser => resolveChooser(fileChooser);
    // Listen before the click, but start the event deadline after the click.
    // CloakBrowser may spend longer than the event budget moving the pointer.
    page.on('filechooser', onChooser);
    try {
        await click();
        return await Promise.race([
            chooser,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('IMAGE_UPLOAD_VERIFY_FAILED: File chooser did not open after Upload click completed')), timeout);
            }),
        ]);
    } finally {
        clearTimeout(timer);
        page.off('filechooser', onChooser);
    }
}

async function countAngularPromptMedia(page) {
    return (await page.evaluate(readPromptMedia)) ?? 0;
}

async function pasteAngularPrompt(page, prompt, log = () => {}) {
    const { comparePromptContent } = require('./promptContent');
    const selector = '[data-harumi-prompt-editor="true"]';
    const verifyCaret = async () => {
        const ready = await page.waitForFunction(selector => {
            const el = document.querySelector(selector);
            if (!el || !(el === document.activeElement || el.contains(document.activeElement))) return false;
            if (el.classList.contains('ProseMirror') && !el.classList.contains('ProseMirror-focused')) return false;
            if (el instanceof HTMLTextAreaElement) return true;
            const selection = window.getSelection();
            return !!selection?.rangeCount && el.contains(selection.anchorNode) && el.contains(selection.focusNode);
        }, selector, { timeout: 3000 });
        await ready.dispose();
    };
    const markEditor = async () => {
        const ready = await page.waitForFunction(readPromptMedia, 'editor', { timeout: 35000 });
        await ready.dispose();
        return page.locator(selector);
    };
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            let editor = await markEditor();
            log('[STEP 8] Activating prompt editor: ' + await editor.evaluate(el => el.className || el.tagName));
            // Like the reference worker, activate the editor by clicking before
            // focusing it. Angular may replace the node during activation/clearing.
            await editor.click({ timeout: 10000 });
            editor = await markEditor();
            await editor.focus();
            await verifyCaret();
            log('[STEP 8] Editor focused; waiting 1 second before pasting prompt...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Resolve again in case the editor rerendered during the focus delay.
            editor = await markEditor();
            await editor.focus();
            await verifyCaret();
            if (!await editor.evaluate(el => el === document.activeElement || el.contains(document.activeElement))) {
                throw new Error('PROMPT_FOCUS_FAILED');
            }
            await page.keyboard.press('Control+a');
            await page.keyboard.press('Backspace');
            editor = await markEditor();
            await editor.focus();
            await verifyCaret();
            if (!await editor.evaluate(el => el === document.activeElement || el.contains(document.activeElement))) {
                throw new Error('PROMPT_FOCUS_FAILED');
            }
            await page.keyboard.insertText(prompt);
            await markEditor();
            const verified = await page.waitForFunction(comparePromptContent,
                { selector, prompt, waitForStable: true }, { timeout: 5000 });
            await verified.dispose();
            log('[STEP 8] Prompt content verified in active composer.');
            return;
        } catch (error) {
            const comparison = await page.evaluate(comparePromptContent, { selector, prompt }).catch(() => null);
            log('[STEP 8] Prompt verification details: ' + JSON.stringify(comparison || { editorUnavailable: true }));
            if (attempt === 1) throw new Error('PROMPT_ENTRY_VERIFY_FAILED: ' + error.message);
            log('[STEP 8] Prompt entry not confirmed; reselecting editor and retrying full-text paste.');
        } finally {
            await page.evaluate(() => { window.__harumiPromptVerifiedSince = 0; }).catch(() => {});
        }
    }
}

async function waitForPromptEditor(page, timeout = 35000) {
    const ready = await page.waitForFunction(readPromptMedia, 'kind', { timeout });
    try { return await ready.jsonValue(); } finally { await ready.dispose(); }
}

async function clearAngularIngredients(page, log = () => {}, timeout = 10000) {
    let removed = 0;
    while (true) {
        const count = await page.evaluate(readPromptMedia, 'ingredients');
        if (typeof count !== 'number') throw new Error('INGREDIENT_CLEAR_FAILED: Prompt composer not found');
        if (count === 0) break;
        const button = page.locator('[data-harumi-ingredient-root] flow-image-ingredient-chip button.chip-container').first();
        try {
            await button.scrollIntoViewIfNeeded({ timeout });
            await button.hover({ timeout });
            const rect = await button.boundingBox();
            if (!rect) throw new Error('Ingredient remove button is not visible');
            await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
            const cleared = await page.waitForFunction(readPromptMedia, { ingredientsBelow: count }, { timeout });
            await cleared.dispose();
            removed++;
        } catch (error) {
            throw new Error('INGREDIENT_CLEAR_FAILED: Could not remove remaining ingredient images. ' + error.message);
        }
    }
    log(`[STEP 8] Removed ${removed} ingredient image(s); Text to Video composer has no ingredients.`);
}

async function ingredientSnapshot(page) {
    const sources = await page.evaluate(readPromptMedia, 'ingredientSnapshot');
    return Array.isArray(sources) && sources.length && sources.every(Boolean) ? JSON.stringify(sources.sort()) : null;
}

async function referenceImageKey(paths) {
    const fs = require('node:fs/promises');
    const { createHash } = require('node:crypto');
    const hashes = await Promise.all(paths.map(async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')));
    return JSON.stringify([...new Set(hashes)].sort());
}

module.exports = { findAngularUploadButton, addAngularMediaToPrompt, selectAngularImagesTab, clickUploadMedia, waitForUploadChooser, countAngularPromptMedia, pasteAngularPrompt, waitForPromptEditor, clearAngularIngredients, ingredientSnapshot, referenceImageKey };
