// inject.js chạy trong Main World (ngữ cảnh của trang web labs.google)
console.log("[Veo Extension] Inject script loaded.");

let isTracking = false;

// Lắng nghe lệnh từ content.js
window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    
    if (event.data && event.data.type === 'VEO_START_TRACKING') {
        console.log("[Veo Extension] Bắt đầu theo dõi kết quả API...");
        isTracking = true;
    } else if (event.data && event.data.type === 'VEO_PREPARE_JOB') {
        console.log(`[Veo Extension] Chuẩn bị job: ${event.data.jobId}`);
        isTracking = false; // Reset trạng thái
    } else if (event.data && event.data.type === 'VEO_INJECT_PROMPT') {
        console.log("[Veo Extension Main World] Nhận yêu cầu nhập prompt...");
        const promptText = event.data.prompt;
        
        // Ưu tiên tìm thẻ div role=textbox contenteditable=true như user cung cấp
        const editor = document.querySelector('div[role="textbox"], [contenteditable="true"], [data-slate-editor="true"]');
        if (!editor) {
            window.postMessage({ type: 'VEO_PROMPT_INJECTED', success: false, error: "Không tìm thấy editor" }, '*');
            return;
        }

        try {
            // Bước 1: Focus và Click vào giữa Editor để Slate.js khởi tạo trạng thái
            editor.focus();
            const rect = editor.getBoundingClientRect();
            const clickOpts = { bubbles: true, cancelable: true, clientX: rect.left + rect.width/2, clientY: rect.top + rect.height/2 };
            editor.dispatchEvent(new PointerEvent('pointerdown', clickOpts));
            editor.dispatchEvent(new MouseEvent('mousedown', clickOpts));
            editor.dispatchEvent(new PointerEvent('pointerup', clickOpts));
            editor.dispatchEvent(new MouseEvent('mouseup', clickOpts));
            editor.dispatchEvent(new MouseEvent('click', clickOpts));
            
            // Đợi Slate.js xử lý xong sự kiện click
            await new Promise(r => setTimeout(r, 500));

            // Bước 2: Tìm thẻ chứa text thực sự để bơm chữ (giống y hệt script console)
            const innerNode = editor.querySelector('[data-slate-string="true"]') || editor.querySelector('[data-slate-node="element"]') || editor;
            
            // Bước 3: Cắm con trỏ (Range) vào thẻ đó
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(innerNode);
            range.collapse(false); // Đặt con trỏ ở cuối
            selection.removeAllRanges();
            selection.addRange(range);

            // Bước 4: Chèn chữ bằng sự kiện beforeinput (Đây là cách an toàn nhất cho Slate.js)
            console.log("[Veo Extension Main World] Bắt đầu chèn prompt bằng beforeinput...");
            
            // Tạo sự kiện gõ phím giả lập để Slate.js tự xử lý thay vì ép DOM thay đổi (execCommand)
            const inputEvent = new InputEvent('beforeinput', {
                inputType: 'insertText',
                data: promptText,
                bubbles: true,
                cancelable: true
            });
            
            editor.dispatchEvent(inputEvent);
            
            await new Promise(r => setTimeout(r, 500));

            const success = editor.textContent.length > 0;
            window.postMessage({ type: 'VEO_PROMPT_INJECTED', success: success }, '*');
        } catch (e) {
            window.postMessage({ type: 'VEO_PROMPT_INJECTED', success: false, error: e.message }, '*');
        }
    }
});

// Chặn fetch (monkey-patching)
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    
    // Thực hiện request thật
    const response = await originalFetch.apply(this, args);
    
    // Nếu không phải trong trạng thái tracking, hoặc không phải API trpc, bỏ qua
    if (!isTracking || !requestUrl || !requestUrl.includes('/trpc/')) {
        return response;
    }
    
    // Clone response để đọc nội dung mà không ảnh hưởng tới luồng chính
    const clone = response.clone();
    
    clone.json().then(data => {
        try {
            // Cấu trúc TRPC thường là mảng các mảng hoặc object
            // Tìm đệ quy bất kỳ chuỗi nào có đuôi video hoặc chứa fifeUri
            const fifeUri = findFifeUri(data);
            
            if (fifeUri) {
                console.log("[Veo Extension] Tìm thấy Video URL:", fifeUri);
                isTracking = false; // Dừng theo dõi
                
                // Gửi về content.js
                window.postMessage({
                    type: 'VEO_JOB_COMPLETED',
                    fifeUri: fifeUri
                }, '*');
            }
        } catch (e) {
            // ignore JSON parse errors or other issues
        }
    }).catch(() => {});
    
    return response;
};

// Hàm đệ quy tìm fifeUri trong object/array
function findFifeUri(obj) {
    if (!obj) return null;
    
    if (typeof obj === 'string') {
        // Kiểm tra xem chuỗi có giống video URL không
        // Các URL của google content thường có dạng lh3.googleusercontent.com/...
        // Thường kết thúc bằng .mp4 hoặc có tham số mime=video/mp4
        if (obj.includes('googleusercontent.com') && (obj.includes('mp4') || obj.includes('video'))) {
            return obj;
        }
    }
    
    if (typeof obj === 'object') {
        // Ưu tiên key fifeUri nếu có
        if (obj.fifeUri && typeof obj.fifeUri === 'string' && obj.fifeUri.includes('video')) {
             return obj.fifeUri;
        }
        
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const found = findFifeUri(obj[key]);
                if (found) return found;
            }
        }
    }
    
    return null;
}
