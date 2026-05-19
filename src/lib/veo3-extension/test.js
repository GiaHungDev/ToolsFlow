const Veo3PipelineController = require('./Veo3PipelineController');
const path = require('path');

// 1. Khởi tạo Master Service giả lập để lắng nghe log và status
const mockMaster = {
    maxVideoThreads: 1,
    maxImageThreads: 0,
    outputDir: 'C:\\Users\\admin\\OneDrive\\Pictures\\MINH',
    activeJobs: new Map(),
    log: (msg, type = 'info') => console.log(`[Master][${type.toUpperCase()}] ${msg}`),
    updateJobStatus: (id, status, error, finalPath, mediaUrl) => {
        console.log(`\n---> [TRẠNG THÁI JOB] Job ${id} chuyển sang: ${status}`);
        if (finalPath) console.log(`---> [FILE ĐÃ TẢI VỀ]: ${finalPath}`);
        if (error) console.log(`---> [LỖI]: ${error}`);
    }
};

// 2. Khởi tạo tài khoản Google với Cookies
const mockAccount = {
    id: 'test_account_01',
    email: 'lethienkhang20022@gmail.com',
    password: '',
    twoFactorSecret: '',
    loginType: 'manual',
    headless: false,
    profilePath: 'C:\\Profiles_BAS_Flow',
    cookies: { "url": "https://labs.google", "cookies": [{ "domain": ".labs.google", "expirationDate": 1813132921.379395, "hostOnly": false, "httpOnly": false, "name": "_ga", "path": "/", "sameSite": "unspecified", "secure": false, "session": false, "storeId": "0", "value": "GA1.1.1045702854.1778465014" }, { "domain": "labs.google", "expirationDate": 1781057016, "hostOnly": true, "httpOnly": false, "name": "EMAIL", "path": "/", "sameSite": "unspecified", "secure": false, "session": false, "storeId": "0", "value": "%22lethienkhang20022%40gmail.com%22" }, { "domain": "labs.google", "hostOnly": true, "httpOnly": true, "name": "__Host-next-auth.csrf-token", "path": "/", "sameSite": "lax", "secure": true, "session": true, "storeId": "0", "value": "400ac6f5a3d99e93e8f81b7153fd2a703eb5bee243915d4ecdcb452116eef971%7C185cd5c20b3f44bc050501751692d57f8bf404a17d4aba8006db536e4905cf1b" }, { "domain": "labs.google", "hostOnly": true, "httpOnly": true, "name": "__Secure-next-auth.callback-url", "path": "/", "sameSite": "lax", "secure": true, "session": true, "storeId": "0", "value": "https%3A%2F%2Flabs.google%2Ffx%2Ftools%2Fflow%2Fproject%2F4d49eaad-06a5-47a6-ad12-0cc77dbc3c67" }, { "domain": "labs.google", "hostOnly": true, "httpOnly": true, "name": "email", "path": "/", "sameSite": "unspecified", "secure": false, "session": true, "storeId": "0", "value": "lethienkhang20022%40gmail.com" }, { "domain": ".labs.google", "expirationDate": 1813132921.704141, "hostOnly": false, "httpOnly": false, "name": "_ga_X2GNH8R5NS", "path": "/", "sameSite": "unspecified", "secure": false, "session": false, "storeId": "0", "value": "GS2.1.s1778572849$o5$g1$t1778572921$j59$l0$h941432969" }, { "domain": "labs.google", "expirationDate": 1781164929.920721, "hostOnly": true, "httpOnly": true, "name": "__Secure-next-auth.session-token", "path": "/", "sameSite": "lax", "secure": true, "session": false, "storeId": "0", "value": "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..wDMSS8eYA5c--u9J.TR_R4si9-hAQXgGrNIAFB7HztZZJ2_KeSEu-xBGU_U0UQcJ8HTogyN7uqTo_fcLYrKwwRHHY_OdIx2O5SFiveTQMjyCx8VG7zMs9WkonTUUsw4nCrLYZ5Gg5vMOOFwbItJ5yYIxjmu3oHVQsaNndwT9a1DS_pBOIDOakqucUyI1LFrwqQitCwjv0X8kkVhp_XXF52EUGD34QQWGxYPFfANvHYEZXnvTRlS0qDUvfdPYv4SPoSFMbuJKlLxUP7dAOBFTs93FPMQqAjoSjB-2Z8YiuxRZjCg5DcbwQkCO0CrEM8WmxjZyUCLsHrrSXmVlLWr7ohPOi9hohIOjfW6CE4eCt0eKilEMAnB72XurSoqGdnjLTQUnc7Ad0hLaXakwwcOHVe-0t6Hy69ywGLhr2FN5Xzh43n6y5EHvZbzz7IAQVC1R4BxAt4LS8Ku62OprpmlY2Ps9NtLhNCHl-N9BecKn9k-AjvXxDPHfStd3ouHHcZmqKTVFCU5K9gmd1cop6C9nd4IVubIGYqZbsX4sGwiPbWCEWmokvk47ACD9OcMfkhnlwsPoU2OsKNWsmkZFRaxzxLlBDpLMU754XJjnSI2j2zIuIbw0wseJEKjbycpYBXzoG0nJvbZaB_-Tx3mvoieg1rjMWlbs6Zv35LhTutCa3DOoGsvgBV2-fRUzJd_FbSowk_-_kWFiG_oJ_BmcdWOlzLa0jxAxf8RSRGXrgaHwpEy01_RGxgYhjFP6NxaT-zRDd0qyhUpFcatIRWgI7E1rZcuUAZ9wKubQ7S8gcwf_B7Q7Q-OyNgQPtAiaAgpngadWnnPc4JOv-QzxPD9GO0hy04J5tTQohaPo3SrqL7A5W-FpfvyM9Yv85Mkinat_FyxpRXv4pO-qjhnL6OR5jpFzyWxLXgvaUWfiLb2bTj66d3Jm-x6R3JJre4kTEso_MREQ8s4bjVhoCjMjUkP7JK6u7AT7oYj7wUSiNAuyYQXMsHpwziUK2LahGGQKEcg.yF-ZeC0zHyrs3S6e4axPYA" }] }
};

// Khởi tạo Controller
const controller = new Veo3PipelineController(mockAccount, mockMaster, null, 'edge', null);

// 3. Tạo một yêu cầu (Job) chạy thử
const sampleJob = {
    id: `JOB_${Date.now()}`,
    prompt: 'A cute cat sitting on a table, 4k resolution, cinematic lighting', // Câu lệnh cần tạo
    isImageTask: false,   // false = tạo Video, true = tạo Ảnh
    typeVideo: 'T2V',     // Text to Video
    settings: {
        videoSettings: {
            ratio: '16:9', // Tỉ lệ khung hình
            count: 1,
            model: 'Veo 3.1 - Lite [Lower Priority]'
        }
    },
    outputDir: '' // Lưu thẳng vào thư mục outputs
};

// 4. Hàm chạy chính
async function runTest() {
    console.log("=== BẮT ĐẦU CHẠY THỬ NGHIỆM VEO3 CONTROLLER ===");

    // Khởi động trình duyệt và đăng nhập
    await controller.start();

    console.log("\n=== TRÌNH DUYỆT ĐÃ SẴN SÀNG, CHUẨN BỊ NẠP JOB SAU 5 GIÂY ===");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Đẩy Job vào hàng đợi để Controller xử lý
    controller.addJob(sampleJob);
}

// Bắt lỗi nếu có
runTest().catch(err => {
    console.error("Lỗi khi chạy test:", err);
});
