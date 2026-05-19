// Tiêm inject.js vào trang web (Main World)
const script = document.createElement('script');
script.src = chrome.runtime.getURL('inject.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

let currentJob = null;

// Lắng nghe lệnh từ dashboard
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'START_JOB') {
        console.log("Nhận lệnh START_JOB:", request.job);
        currentJob = request.job;
        startJobProcess(request.job)
            .then(() => sendResponse({ status: 'ok' }))
            .catch(err => sendResponse({ status: 'error', error: err.message }));
        
        return true; // Để giữ kết nối cho sendResponse bất đồng bộ
    }
});

// Lắng nghe sự kiện từ inject.js (qua postMessage)
window.addEventListener('message', (event) => {
    // Chúng ta chỉ nhận message từ cùng window
    if (event.source !== window) return;

    if (event.data && event.data.type === 'VEO_JOB_COMPLETED') {
        console.log("Content script nhận được VEO_JOB_COMPLETED", event.data);
        if (currentJob) {
            chrome.runtime.sendMessage({
                type: 'JOB_COMPLETED',
                jobId: currentJob.id,
                fifeUri: event.data.fifeUri
            });
            currentJob = null;
        }
    } else if (event.data && event.data.type === 'VEO_JOB_FAILED') {
        console.log("Content script nhận được VEO_JOB_FAILED", event.data);
        if (currentJob) {
            chrome.runtime.sendMessage({
                type: 'JOB_FAILED',
                jobId: currentJob.id,
                error: "Job bị lỗi trong lúc render"
            });
            currentJob = null;
        }
    }
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startJobProcess(job) {
    // 1. Kiểm tra xem có đang ở trang chủ (chưa có editor) không
    let editor = document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('[data-slate-editor="true"]');
    
    if (!editor) {
        console.log("Chưa thấy editor. Đang tìm nút New project / Create with Flow...");
        // Thử tìm nút New project trong 10 giây
        const newProjectBtn = await findNewProjectButton(10000);
        if (newProjectBtn) {
            console.log("Đã tìm thấy nút New project, tiến hành click...");
            // Click bằng event dispatch thay vì native click để bypass React
            await simulateHumanClick(newProjectBtn);
            // Đợi 2 giây cho UI chuyển cảnh
            await sleep(2000);
        } else {
            console.log("Không tìm thấy nút New project, sẽ tiếp tục chờ editor...");
        }
        
        // Chờ editor xuất hiện sau khi click (hoặc nếu nó tự load)
        editor = await waitForElement('div[role="textbox"][contenteditable="true"], [data-slate-editor="true"]', 30000);
    }

    if (!editor) throw new Error("Không tìm thấy ô nhập Prompt.");

    // Gửi tín hiệu để inject.js biết chuẩn bị
    window.postMessage({ type: 'VEO_PREPARE_JOB', jobId: job.id }, '*');

    // 2. Cấu hình Job (Mode, Ratio, Model)
    await configureJobOptions(job);

    // 3. Xử lý nhập Prompt
    editor = document.querySelector('div[role="textbox"][contenteditable="true"]') || document.querySelector('[data-slate-editor="true"]');
    if (!editor) throw new Error("Không tìm thấy ô nhập Prompt.");

    // BƯỚC 3: Click focus vào editor (giống Puppeteer bước 3)
    editor.focus();
    await simulateHumanClick(editor);
    await sleep(300);
    
    // BƯỚC 3b: Xóa câu lệnh cũ qua nút X (Copy chuẩn logic Veo3PipelineController.js)
    await (async () => {
        const allBtns = Array.from(document.querySelectorAll('button'));
        for (const btn of allBtns) {
            const spans = Array.from(btn.querySelectorAll('span'));
            const hasXLabel = spans.some(s => s.textContent.trim() === 'Xoá câu lệnh' || s.textContent.trim() === 'Clear prompt');
            const googleIcon = btn.querySelector('i.google-symbols, i[class*="google-symbols"]');
            const hasCloseIcon = googleIcon && googleIcon.textContent.trim() === 'close';
            
            if (hasXLabel || hasCloseIcon) {
                const r = btn.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                    await simulateHumanClick(btn);
                    console.log("Đã bấm nút Xoá câu lệnh cũ.");
                    await sleep(500);
                    return;
                }
            }
        }
    })();

    // Chuẩn bị prompt
    const trackingSignature = `\n\n[Ignore this: JobID=${job.id}]`;
    const cleanPrompt = job.prompt.replace(/--ar\s+\d+[:-]\d+/gi, '').replace(/--ar \d+\/\d+/gi, '').trim() + trackingSignature;

    console.log("Đang gửi yêu cầu nhập prompt sang Main World...");
    
    const injectPromise = new Promise((resolve, reject) => {
        const handler = (event) => {
            if (event.source !== window) return;
            if (event.data && event.data.type === 'VEO_PROMPT_INJECTED') {
                window.removeEventListener('message', handler);
                if (event.data.success) resolve();
                else reject(new Error(event.data.error || "Nhập prompt thất bại"));
            }
        };
        window.addEventListener('message', handler);
    });

    window.postMessage({ type: 'VEO_INJECT_PROMPT', prompt: cleanPrompt }, '*');
    
    try {
        // Đợi tối đa 5 giây
        await Promise.race([
            injectPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout khi đợi inject prompt")), 5000))
        ]);
        console.log("Inject prompt thành công từ Main World.");
    } catch (e) {
        throw new Error(`Lỗi khi nhập prompt: ${e.message}`);
    }

    // 4. Click nút Generate (BƯỚC 5 & SUBMIT trong file mẫu)
    const generateBtn = await findGenerateButton();
    if (generateBtn) {
        await simulateHumanClick(generateBtn);
        console.log("Đã click nút Submit (Generate).");
    } else {
        console.log("Không thấy nút Generate, chuẩn bị dùng phím Enter làm fallback...");
    }

    // 5. Kiểm tra trạng thái Submit và sử dụng Enter Fallback nếu cần
    console.log("Đang chờ xác nhận từ Google...");
    window.postMessage({ type: 'VEO_START_TRACKING' }, '*');

    let isSubmitted = false;
    let hitEnterFallback = false;

    for (let i = 0; i < 15; i++) {
        await sleep(1000);
        
        const check = await (async () => {
            // 5a. Kiểm tra lỗi (Policy, Error)
            const alerts = Array.from(document.querySelectorAll('[role="alert"], [class*="snackbar"], snack-bar, .msg, .toast, .error'));
            for (let a of alerts) {
                if (a.offsetParent === null) continue;
                const t = (a.innerText || "").trim().toLowerCase();
                if (t.length > 5 && (t.includes('vi phạm') || t.includes('chính sách') || t.includes('policy') || t.includes('cấm') || t.includes('error') || t.includes('lỗi') || t.includes('could not') || t.includes('không thể'))) {
                    return { type: 'error', msg: a.innerText.trim() };
                }
            }

            // 5b. Kiểm tra trạng thái đang chạy (Generating, %, hoặc editor bị clear)
            const texts = Array.from(document.querySelectorAll('span, div, p'));
            const isRunning = texts.some(el => {
                if (el.offsetParent === null) return false;
                const t = el.textContent.trim();
                return t.includes('Đang tạo') || t.includes('Generating') || t.includes('Creating') || t.includes('Queued') || (t.endsWith('%') && t.length <= 5);
            });
            if (isRunning) return { type: 'success' };

            // Editor bị xóa sạch chữ cũng là dấu hiệu đã gửi
            const editorEl = document.querySelector('[data-slate-editor="true"]');
            if (editorEl && editorEl.textContent.trim().length < 5) return { type: 'success' };

            return { type: 'waiting' };
        })();

        if (check.type === 'error') {
            throw new Error(`Google từ chối Prompt: "${check.msg}"`);
        } else if (check.type === 'success') {
            isSubmitted = true;
            console.log("Xác nhận: Job đã được gửi thành công!");
            break;
        }

        // 5c. Fallback: Nếu 5 giây trôi qua mà chưa có trạng thái Success/Error, bấm Enter!
        if (i === 4 && !isSubmitted && !hitEnterFallback) {
            console.log("Đã đợi 5 giây nhưng lệnh chưa gửi được bằng nút chuột, thử ấn Enter dự phòng...");
            hitEnterFallback = true;
            const editorElFallback = document.querySelector('[data-slate-editor="true"]');
            if (editorElFallback) {
                editorElFallback.focus();
                editorElFallback.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
            }
        }
    }

    if (!isSubmitted) {
        console.warn("Không tìm thấy xác nhận Submit từ UI, nhưng vẫn sẽ tiếp tục theo dõi API...");
    }
    
    // Khởi chạy vòng lặp kiểm tra API (Chạy ngầm, không block luồng trả về)
    pollForVideoCompletion(job.id);
}

async function pollForVideoCompletion(jobId) {
    console.log(`[Polling] Bắt đầu theo dõi tiến độ Job ${jobId}...`);
    let percentSeen = false;
    let waitingWithoutPercent = 0;
    
    // Polling tối đa 10 phút (60 lần * 10 giây)
    for (let i = 0; i < 60; i++) { 
        await sleep(10000); // Kiểm tra mỗi 10 giây
        
        let hasPercent = false;
        const allDivs = document.querySelectorAll("span, div, p");
        for (let el of allDivs) {
            const text = (el.textContent || "").trim();
            if (text.includes("%") && text.length <= 5) hasPercent = true;
            if (text === 'Đang tạo' || text === 'Generating' || text === 'Creating' || text === 'Queued') hasPercent = true;
        }
        
        if (hasPercent) {
            percentSeen = true;
            waitingWithoutPercent = 0;
            console.log(`[Polling] Job ${jobId} đang chạy...`);
            continue;
        }
        
        // Nếu không có % mà trước đó chưa từng thấy %, thì chờ thêm tối đa 10 vòng (100s)
        if (!percentSeen) {
            waitingWithoutPercent++;
            if (waitingWithoutPercent < 10) {
                console.log(`[Polling] Job ${jobId} đang chờ hệ thống xếp hàng...`);
                continue; 
            }
        }
        
        console.log(`[Polling] Job ${jobId} đã render xong trên UI. Đang fetch API lấy Video URL...`);
        const pIdMatch = window.location.href.match(/\/project\/([a-zA-Z0-9\-]+)/);
        const projectId = pIdMatch ? pIdMatch[1] : '';
        if (!projectId) {
            console.error("[Polling] Không lấy được Project ID từ URL");
            continue;
        }
        
        try {
            const apiUrl = `https://labs.google/fx/api/trpc/project.searchProjectWorkflows?input={"json":{"pageSize":10,"projectId":"${projectId}","toolName":"PINHOLE","fetchBookmarked":false,"rawQuery":"","cursor":null},"meta":{"values":{"cursor":["undefined"]}}}`;
            const res = await fetch(apiUrl);
            const jsonData = await res.json();
            const workflows = jsonData?.result?.data?.json?.result?.workflows || [];
            
            let foundUrl = null;
            for (let w of workflows) {
                const steps = w.workflowSteps || [];
                for (let s of steps) {
                    let prompt = "";
                    try { prompt = s.workflowStepLog.requestData.promptInputs[0].structuredPrompt.parts[0].text || ""; } catch(e){}
                    if (prompt.includes(`JobID=${jobId}`)) {
                        const gens = s.mediaGenerations || [];
                        for (let g of gens) {
                            foundUrl = g.mediaData?.videoData?.fifeUri || g.mediaData?.imageData?.fifeUri || null;
                            if (foundUrl) break;
                        }
                    }
                    if (foundUrl) break;
                }
                if (foundUrl) break;
            }
            
            if (foundUrl) {
                console.log(`[Polling] THÀNH CÔNG! Đã lấy được URL: ${foundUrl}`);
                chrome.runtime.sendMessage({
                    type: 'JOB_COMPLETED',
                    jobId: jobId,
                    fifeUri: foundUrl
                });
                return; // Kết thúc polling
            } else {
                console.log("[Polling] API chưa trả về URL, chờ thêm...");
            }
        } catch (e) {
            console.error("[Polling] Lỗi fetch API:", e.message);
        }
    }
    
    // Quá thời gian 10 phút
    chrome.runtime.sendMessage({
        type: 'JOB_FAILED',
        jobId: jobId,
        error: "Timeout sau 10 phút chờ video."
    });
}


function waitForElement(selector, timeout) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                resolve(document.querySelector(selector));
                observer.disconnect();
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

async function findGenerateButton() {
    // Trong giao diện Veo, nút Submit lệnh là nút mũi tên (arrow_forward)
    const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
    for (let btn of buttons) {
        const text = btn.textContent || "";
        if (text.includes('arrow_forward')) {
            if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                return btn;
            }
        }
    }
    
    // Nếu không tìm thấy bằng text 'arrow_forward', thử tìm nút gần editor nhất
    const editor = document.querySelector('[data-slate-editor="true"]');
    if (editor) {
        const container = editor.closest('div[class*="container"], form') || editor.parentElement.parentElement;
        const potentialBtns = container.querySelectorAll('button');
        if (potentialBtns.length > 0) {
            for (let btn of potentialBtns) {
                 if (!btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                    const btnText = btn.textContent.toLowerCase();
                    // BỎ QUA nút "Create" (Tạo dự án mới) để tránh click nhầm
                    if (btnText.includes('create') || btnText.includes('tạo')) {
                        continue;
                    }
                    return btn;
                }
            }
        }
    }
    return null;
}

async function findNewProjectButton(timeout) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        // Tìm thẻ div hoặc button có chứa dòng chữ 'New project' hoặc 'Dự án mới'
        const candidates = Array.from(document.querySelectorAll('a, button, div[role="button"], span, div'));
        for (let el of candidates) {
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            // Điều kiện tìm kiếm hệt như Veo3PipelineController.js
            if (text.length > 0 && text.length < 50 && (text.includes('new project') || text.includes('dự án mới') || text.includes('create with flow') || text.includes('tạo bằng flow'))) {
                let target = el;
                // Đi lên để tìm thẻ có thể click được
                while (target && target.tagName !== 'A' && target.tagName !== 'BUTTON' && target.getAttribute('role') !== 'button') {
                    if (!target.parentElement || target.tagName === 'BODY') break;
                    target = target.parentElement;
                }
                
                // Đảm bảo element đang hiển thị
                const rect = target.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    console.log("[Extension] Tìm thấy mục tiêu click:", target.tagName, text);
                    // Scroll vào giữa màn hình trước khi click (giống Puppeteer)
                    target.scrollIntoView({ behavior: 'instant', block: 'center' });
                    return target;
                }
            }
        }
        await sleep(500);
    }
    return null;
}

async function simulateHumanClick(element) {
    if (!element) return;
    
    // 1. Scroll mượt mà đến phần tử để Google thấy hành động như người dùng thật
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(Math.floor(Math.random() * 200) + 300);

    element.focus();
    
    const rect = element.getBoundingClientRect();
    
    // 2. Tính toán tọa độ đích ngẫu nhiên bên trong nút (Lệch tâm)
    const offsetX = (Math.random() - 0.5) * (rect.width * 0.4);
    const offsetY = (Math.random() - 0.5) * (rect.height * 0.4);
    const targetX = rect.left + (rect.width / 2) + offsetX;
    const targetY = rect.top + (rect.height / 2) + offsetY;
    
    // 3. Giả lập di chuột cong (Mouse Path Interpolation giống hệt Puppeteer)
    // Chọn một điểm bắt đầu ngẫu nhiên cách đích khoảng 50-100px
    const startX = targetX + (Math.random() * 100 - 50);
    const startY = targetY + (Math.random() * 100 - 50);
    
    const steps = 4 + Math.floor(Math.random() * 4); // Chia làm 4 đến 8 bước di chuyển
    for (let i = 1; i <= steps; i++) {
        const stepX = startX + (targetX - startX) * (i / steps);
        const stepY = startY + (targetY - startY) * (i / steps);
        
        element.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, cancelable: true, view: window,
            clientX: stepX, clientY: stepY
        }));
        await sleep(Math.floor(Math.random() * 15) + 5); // Chờ 5-20ms mỗi bước
    }

    const clickOptions = {
        bubbles: true, cancelable: true, view: window,
        clientX: targetX, clientY: targetY, button: 0, buttons: 1
    };
    
    element.dispatchEvent(new MouseEvent('mouseover', clickOptions));
    element.dispatchEvent(new MouseEvent('mouseenter', clickOptions));
    await sleep(Math.floor(Math.random() * 30) + 20); // Dừng lại một nhịp trước khi bấm

    // 4. Nhấn chuột xuống (mousedown)
    element.dispatchEvent(new PointerEvent('pointerdown', clickOptions));
    element.dispatchEvent(new MouseEvent('mousedown', clickOptions));
    
    // 5. Độ trễ giữ chuột (delay bấm phím của người thật)
    await sleep(Math.floor(Math.random() * 80) + 20);

    // 6. Nhả chuột và thực hiện click
    element.dispatchEvent(new PointerEvent('pointerup', clickOptions));
    element.dispatchEvent(new MouseEvent('mouseup', clickOptions));
    element.dispatchEvent(new MouseEvent('click', clickOptions));
}
async function configureJobOptions(job) {
    console.log("[Extension] Bắt đầu cấu hình Job...", job);

    const isImg = job.typeVideo === 'IMG';
    
    // 1. Mở Create Menu
    const triggerMenuBtn = await waitForElement('button[aria-haspopup="menu"]:has(div[data-type="button-overlay"]):not(:has(span))', 5000);
    if (triggerMenuBtn) {
        console.log("Mở menu cấu hình...");
        await simulateHumanClick(triggerMenuBtn);
        await sleep(1000);
    } else {
        console.log("Không tìm thấy nút mở menu cấu hình (có thể nó đã mở sẵn).");
    }

    // 2. Chọn Mode (Video / Image)
    const modeSelector = isImg ? 'button[aria-controls$="-content-IMAGE"]' : 'button[aria-controls$="-content-VIDEO"]';
    const modeBtn = document.querySelector(modeSelector);
    if (modeBtn) {
        console.log(`Chọn Mode: ${isImg ? 'IMAGE' : 'VIDEO'}`);
        await simulateHumanClick(modeBtn);
        await sleep(1000);
    }

    // 3. Chọn SubMode nếu là Video
    if (!isImg) {
        let subSelector = null;
        if (job.typeVideo === 'IN2V') subSelector = 'button[aria-controls$="-content-VIDEO_REFERENCES"]';
        if (job.typeVideo === 'I2V') subSelector = 'button[aria-controls$="-content-VIDEO_FRAMES"]';
        
        if (subSelector) {
            const subModeBtn = document.querySelector(subSelector);
            if (subModeBtn) {
                console.log(`Chọn SubMode: ${job.typeVideo}`);
                await simulateHumanClick(subModeBtn);
                await sleep(1000);
            }
        }
    }

    // 4. Chọn Aspect Ratio
    let ratioSelector = null;
    if (job.ratio === '16:9' || job.ratio === 'Ngang') {
        ratioSelector = 'button[aria-controls$="-content-LANDSCAPE"]';
    } else if (job.ratio === '9:16' || job.ratio === 'Dọc') {
        ratioSelector = 'button[aria-controls$="-content-PORTRAIT"]';
    } else if (job.ratio === '1:1') {
        ratioSelector = 'button[aria-controls$="-content-SQUARE"]';
    }
    
    if (ratioSelector) {
        const ratioBtn = document.querySelector(ratioSelector);
        if (ratioBtn) {
            console.log(`Chọn Ratio: ${job.ratio}`);
            await simulateHumanClick(ratioBtn);
            await sleep(500);
        }
    }

    // 5. Chọn Model
    if (job.model) {
        console.log(`Bắt đầu chọn Model: ${job.model}`);
        // Tìm nút mở dropdown model. Nó chứa các chữ như Veo, Imagen, Nano Banana
        const modelTriggers = Array.from(document.querySelectorAll('button'));
        const modelBtn = modelTriggers.find(btn => {
            const text = btn.textContent.toLowerCase();
            return text.includes('veo') || text.includes('imagen') || text.includes('nano banana');
        });

        if (modelBtn) {
            await simulateHumanClick(modelBtn);
            await sleep(1000); // Chờ menu xổ ra
            
            // Tìm option
            const options = Array.from(document.querySelectorAll('div[role="option"], li[role="option"], span'));
            const targetOption = options.find(opt => {
                const text = opt.textContent.toLowerCase().trim();
                return text === job.model.toLowerCase().trim() || text.includes(job.model.toLowerCase().trim());
            });

            if (targetOption) {
                // Tìm thẻ cha click được
                let clickable = targetOption;
                while (clickable && clickable.tagName !== 'DIV' && clickable.tagName !== 'LI') {
                    if (!clickable.parentElement) break;
                    clickable = clickable.parentElement;
                }
                await simulateHumanClick(clickable || targetOption);
                console.log(`Đã chọn Model: ${job.model}`);
            } else {
                console.log(`Không tìm thấy option Model: ${job.model} trong danh sách.`);
                // Đóng menu nếu không tìm thấy
                await simulateHumanClick(document.body);
            }
            await sleep(500);
        }
    }

    // Đóng menu an toàn bằng Escape 2 lần
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await sleep(300);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await sleep(500);
}
