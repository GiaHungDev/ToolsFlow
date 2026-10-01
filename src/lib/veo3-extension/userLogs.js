"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVeo3LogFormatter = createVeo3LogFormatter;
/** Vietnamese user logs shared by the service and UI. */
function createVeo3LogFormatter() {
    const jobs = new Map();
    const progress = new Map();
    const seen = new Set();
    return (raw) => {
        const time = raw.match(/^\[([^\]]+)\]/)?.[0] || '';
        const worker = raw.match(/\[Worker (\d+)\]/)?.[1];
        const job = worker ? jobs.get(worker) : undefined;
        const scope = worker ? `[Luồng ${worker}${job ? ` · Tác vụ ${job}` : ''}] ` : '';
        const text = raw.replace(/^\[[^\]]+\]\s*/, '').trim();
        const output = (message, once) => {
            const key = `${worker || 'system'}:${job || ''}:${once}`;
            if (once && seen.has(key))
                return null;
            if (once)
                seen.add(key);
            return `${time} ${scope}${message}`.trim();
        };
        let match;
        if ((match = raw.match(/Bắt đầu xử lý Job (\d+)\/(\d+) \(ID: (.*?)\) trên luồng (\d+)/))) {
            jobs.set(match[4], match[3]);
            progress.delete(match[4]);
            const workerPrefix = `${match[4]}:`;
            seen.forEach(key => { if (key.startsWith(workerPrefix))
                seen.delete(key); });
            return `${time} ▶ Bắt đầu tác vụ ${match[1]}/${match[2]} (ID: ${match[3]}) trên luồng ${match[4]}`;
        }
        if (/^=+$/.test(text))
            return output(text);
        if (text.includes('BẮT ĐẦU QUÁ TRÌNH'))
            return output('BẮT ĐẦU QUÁ TRÌNH TẠO VIDEO TỰ ĐỘNG');
        if (text.includes('[API Tools]') || text.includes('Đã lấy thành công tài khoản liên kết Flow'))
            return output(text);
        if (text.includes('chưa được liên kết với tài khoản'))
            return output('⚠️ Tài khoản Tools chưa được liên kết với Flow. Vui lòng kiểm tra lại tài khoản.');
        if (text.includes('Đang nạp danh sách Job'))
            return output('Đang nạp danh sách tác vụ từ API...');
        if ((match = text.match(/Phát hiện(?: thêm)? (\d+) jobs pending/)))
            return output(`Phát hiện ${match[1]} tác vụ đang chờ xử lý từ API.`);
        if ((match = text.match(/Đã chuẩn bị (\d+) Job.*khởi động (\d+) trình duyệt/)))
            return output(`✅ Đã chuẩn bị ${match[1]} tác vụ. Đang khởi động ${match[2]} trình duyệt...`);
        if ((match = text.match(/Đã cập nhật trạng thái (\w+) cho Job (.+)/))) {
            const status = { Processing: 'Đang xử lý', Completed: 'Hoàn thành', Failed: 'Thất bại', Pending: 'Chờ xử lý', pending: 'Chờ xử lý' };
            return output(`Đã cập nhật trạng thái ${status[match[1]] || 'Chờ xử lý'} cho tác vụ ${match[2]}`);
        }
        if (text.startsWith('Thư mục lưu video:'))
            return output(text);
        if ((match = text.match(/✅ Job (.+?) thành công! Tên file tải về: (.+)/)))
            return output(`✅ Tác vụ ${match[1]}: tải video thành công. Đã lưu tại: ${match[2]}`);
        if (raw.includes('HẾT CREDIT TẠO VIDEO!'))
            return output('HẾT CREDIT TẠO VIDEO! ĐANG TẠM DỪNG TÁC VỤ VÀ ĐÓNG TRÌNH DUYỆT. VUI LÒNG NẠP CREDIT TRƯỚC KHI CHẠY TIẾP.', 'credits');
        if (raw.includes('FLOW_CREDITS_EXHAUSTED'))
            return null;
        if ((match = raw.match(/Launching CloakBrowser for account (.+?)\.\.\./)))
            return output(`Đang mở trình duyệt cho tài khoản ${match[1]}...`, 'launch');
        if (raw.includes('Navigating to Veo3 for login check'))
            return output('Đang kiểm tra trạng thái đăng nhập...', 'login-check');
        if ((match = raw.match(/Auto-login initiated for (.+)/)))
            return output(`Đang đăng nhập tài khoản ${match[1]}...`, 'login-start');
        if (/Login successful!|Auto-login successful!|Successfully entered Flow workspace|Phiên đăng nhập đã được khôi phục|Login restored successfully/.test(raw))
            return output('✅ Đăng nhập thành công.', 'login-success');
        if (raw.includes('Already logged in or on intermediate'))
            return output('Đang xác nhận phiên đăng nhập và mở Flow...', 'login-verify');
        if (/Manual login timed out/.test(raw))
            return output('❌ Đăng nhập chưa thành công: đã hết thời gian chờ xác nhận.');
        if (/Auto-login failed or needed manual intervention/.test(raw))
            return output('Đang kiểm tra lại phiên đăng nhập...', 'login-recovery');
        if (/STEP 3\/9/.test(raw))
            return output('Đang chuẩn bị dự án...', 'project');
        if (/Confirmed Project Page URL/.test(raw))
            return output('✅ Đăng nhập thành công. Đã vào dự án Flow.', 'project-ready');
        if (/STEP 6\/9/.test(raw))
            return output('Đang thiết lập cấu hình tạo video...', 'settings');
        if (/Angular Flow settings verified/.test(raw))
            return output('✅ Đã thiết lập cấu hình tạo video.', 'settings-ready');
        if (/TOÀN BỘ ẢNH TRÙNG RECORD TRƯỚC/.test(raw))
            return output('Ảnh trùng tác vụ trước: giữ nguyên ảnh đã đính kèm, chỉ thay nội dung mô tả.', 'reuse');
        if ((match = raw.match(/Bat dau xu ly tai len (\d+) anh/)))
            return output(`Đang tải ${match[1]} ảnh tham chiếu...`, 'upload');
        if ((match = raw.match(/Da upload & attach (\d+)\/(\d+) file thanh cong/)))
            return output(`✅ Đã tải lên và thêm ${match[1]}/${match[2]} ảnh vào nội dung tạo video thành công.`, 'attached');
        if (/STEP 8\/9/.test(raw))
            return output('Đang nhập nội dung mô tả video...', 'prompt');
        if (/Clicking submit button/.test(raw))
            return output('Đang gửi yêu cầu tạo video...', 'send');
        if (/\[prompt_submitted\]/.test(raw) && /thành công/.test(raw))
            return output('✅ Đã gửi yêu cầu thành công. Video đang được tạo...', 'submitted');
        if ((match = raw.match(/Tile status: (generating|complete).*?(-?\d+)%/))) {
            const value = match[1] === 'complete' ? 100 : Math.min(100, Number(match[2]));
            const key = worker || 'default';
            if (value <= (progress.get(key) ?? -1) || value < 0)
                return null;
            progress.set(key, value);
            return value === 100
                ? output('✅ Video đã hoàn thành 100%, đang chờ tải xuống.', 'complete')
                : output(`Video đang được hoàn thành: ${value}%.`);
        }
        if (/Render COMPLETE/.test(raw))
            return output('✅ Video đã hoàn thành 100%, đang chờ tải xuống.', 'complete');
        if (/Starting download/.test(raw))
            return output('Đang tải video xuống...', 'download');
        if (/Tile generation error detected/.test(raw)) {
            progress.delete(worker || 'default');
            seen.delete(`${worker || 'system'}:${job || ''}:complete`);
            return output('⚠️ Tạo video chưa thành công. Đang gửi lại yêu cầu...');
        }
        if (/Đang dừng các trình duyệt/.test(raw))
            return output('Đang đóng trình duyệt và tạm dừng tác vụ...');
        if (/Tiến trình đã dừng theo yêu cầu/.test(raw))
            return output('⏸ Đã tạm dừng tác vụ và đóng trình duyệt.');
        if (/Đã hoàn tất tất cả các Job/.test(raw))
            return output('🎉 Đã hoàn tất tất cả tác vụ trong hàng đợi!');
        if (/Không có Job nào cần xử lý/.test(raw))
            return output('Không có tác vụ nào đang chờ xử lý.');
        if (/Đang kiểm tra thêm job mới/.test(raw))
            return output('Đang kiểm tra tác vụ mới...', 'poll');
        if (/Falling back to manual login wait/.test(raw))
            return output('⚠️ Cần bạn hoàn tất đăng nhập trong trình duyệt. Đang chờ xác nhận...', 'manual-login');
        if (/Đang khởi động lại Luồng/.test(raw))
            return output(text);
        if (/khởi động lại thành công/.test(raw))
            return output(text);
        if (/khởi động lại thất bại/.test(raw))
            return output('❌ Không thể khởi động lại trình duyệt. Luồng xử lý đã ngừng hoạt động.');
        if (/Tự động phục hồi Job ID/.test(raw)) {
            const id = raw.match(/Job ID (\S+)/)?.[1];
            return output(`Đã đưa tác vụ ${id || ''} về trạng thái chờ xử lý lại.`);
        }
        if (/Pipeline failed|Lỗi ngoại lệ tại Job|LỖI NGHIÊM TRỌNG|Lỗi khởi động luồng|Lỗi gọi API|\[LỖI API\]|❌ Job/.test(raw)) {
            const reason = /PROMPT_ENTRY/.test(raw) ? 'Không thể nhập hoặc xác nhận nội dung mô tả.'
                : /IMAGE_UPLOAD|INGREDIENT_CLEAR/.test(raw) ? 'Không thể tải lên hoặc xác nhận ảnh tham chiếu.'
                    : /DOWNLOAD|saveAs|ENOSPC|EACCES|EPERM/.test(raw) ? 'Không thể tải hoặc lưu video. Hãy kiểm tra thư mục lưu và dung lượng ổ đĩa.'
                        : /FLOW_SETTINGS/.test(raw) ? 'Không thể xác nhận cấu hình tạo video.'
                            : /LOGIN|login|auth|đăng nhập/i.test(raw) ? 'Đăng nhập chưa thành công. Hãy kiểm tra tài khoản.'
                                : /MEDIA_GENERATION/.test(raw) ? 'Tạo video không thành công.'
                                    : /API|fetch|network/i.test(raw) ? 'Không thể kết nối hoặc cập nhật dữ liệu từ máy chủ.'
                                        : 'Không thể tiếp tục xử lý tác vụ. Vui lòng kiểm tra tài khoản và kết nối.';
            const id = raw.match(/(?:Job|job) (\d+)/)?.[1];
            return output(`❌ ${id && !job ? `Tác vụ ${id}: ` : ''}${reason}`, `error:${reason}`);
        }
        return null;
    };
}
