const express = require('express');
const cors = require('cors');
const path = require('path');
const { globalState, startAutomation, stopAutomation } = require('../src/lib/veo3-extension/automationService');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/veo3/start', async (req, res) => {
    try {
        const body = req.body;

        // 1. Lấy trạng thái
        if (body.action === 'status') {
            return res.json({
                isRunning: globalState.isRunning,
                logs: globalState.logs
            });
        }

        // 2. Dừng tiến trình
        if (body.action === 'stop') {
            stopAutomation();
            return res.json({ success: true, isRunning: false });
        }

        // Khởi động tiến trình nếu chưa chạy
        if (!globalState.isRunning) {
            const token = req.headers.authorization?.split(' ')[1] || '';
            let realTimeIsHeadless = body.isHeadless;
            let debugFetchMsg = 'Không gọi được API';
            try {
                const axios = require('axios');
                const backendUrl = body.apiUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
                
                const response = await axios.get(`${backendUrl}/user/checkme`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                
                const uData = response.data?.data || response.data;
                if (uData && uData.isHeadless !== undefined) {
                    realTimeIsHeadless = uData.isHeadless !== undefined && uData.isHeadless !== null
                        ? String(uData.isHeadless) !== "false" && uData.isHeadless !== 0 && uData.isHeadless !== false
                        : true;
                    debugFetchMsg = `Thành công (isHeadless từ DB: ${uData.isHeadless})`;
                } else {
                    debugFetchMsg = `Thành công nhưng API không trả về trường isHeadless`;
                }
            } catch (err) {
                console.error("[API] Error fetching real-time isHeadless:", err.message);
                debugFetchMsg = `Lỗi axios: ${err.message}`;
            }

            const config = {
                ...body,
                isHeadless: realTimeIsHeadless,
                token,
                apiUrl: body.apiUrl || process.env.NEXT_PUBLIC_API_URL,
                debugFetchMsg
            };
            console.log(`[API] Nhận yêu cầu Start Automation, isHeadless =`, realTimeIsHeadless);
            startAutomation(config);
        }

        return res.json({ success: true, message: 'Automation started' });
    } catch (e) {
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        }
    }
});

app.get('/api/veo3/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Gửi logs cũ nếu đang chạy
    if (globalState.logs.length > 0) {
        for (const log of globalState.logs) {
            if (log === '[DONE]') continue;
            res.write(`data: ${JSON.stringify({ log })}\n\n`);
        }
    } else {
        res.write(`data: ${JSON.stringify({ log: 'Đang kết nối luồng log...' })}\n\n`);
    }

    const listener = (newLog) => {
        if (newLog === '[DONE]') {
            res.write('data: [DONE]\n\n');
            res.end();
        } else {
            res.write(`data: ${JSON.stringify({ log: newLog })}\n\n`);
        }
    };

    globalState.listeners.add(listener);

    req.on('close', () => {
        globalState.listeners.delete(listener);
    });

});

function startLocalApi() {
    const port = 52424;
    app.listen(port, () => {
        console.log(`Local Express API cho Veo3 Automation chạy tại http://127.0.0.1:${port}`);
    });
}

module.exports = { startLocalApi };
