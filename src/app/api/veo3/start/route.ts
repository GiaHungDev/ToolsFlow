import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import readline from 'readline';
import path from 'path';
import fs from 'fs';

// Force Next.js File Tracer to include this module in standalone build
if (false) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('puppeteer-real-browser');
}

// Define global interface to persist state across Next.js API reloads
interface GlobalProcess {
  child: any;
  logs: string[];
  isRunning: boolean;
  listeners: Set<(log: string) => void>;
}

declare global {
  var veo3Process: GlobalProcess | undefined;
}

// Initialize global state if not present
if (!globalThis.veo3Process) {
  globalThis.veo3Process = {
    child: null,
    logs: [],
    isRunning: false,
    listeners: new Set()
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // 1. Check running status and return existing logs for SPA navigation reconnection
    if (body.action === 'status') {
      return NextResponse.json({
        isRunning: globalThis.veo3Process?.isRunning || false,
        logs: globalThis.veo3Process?.logs || []
      });
    }

    // 2. Stop running process on request
    if (body.action === 'stop') {
      if (globalThis.veo3Process && globalThis.veo3Process.isRunning && globalThis.veo3Process.child) {
        try {
          globalThis.veo3Process.child.kill();
        } catch (e) {}
        globalThis.veo3Process.isRunning = false;
        globalThis.veo3Process.child = null;
        globalThis.veo3Process.logs.push('[HỆ THỐNG] Tiến trình đã dừng theo yêu cầu của người dùng.');
        
        globalThis.veo3Process.listeners.forEach((listener) => {
          listener('[HỆ THỐNG] Tiến trình đã dừng theo yêu cầu của người dùng.');
          listener('[DONE]');
        });
        globalThis.veo3Process.listeners.clear();
      }
      return NextResponse.json({ success: true, isRunning: false });
    }

    // 3. Connect to stream or start process
    const token = req.headers.get('authorization')?.split(' ')[1] || '';

    // Lấy config Headless từ Backend bằng token
    let finalIsHeadless = true;
    try {
      if (token) {
        const backendUrl = process.env.NEXT_PUBLIC_API_URL;
        const res = await fetch(`${backendUrl}/user/checkme`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (res.ok) {
          const user = await res.json();
          if (user && user.isHeadless !== undefined) {
            finalIsHeadless = user.isHeadless;
          }
        }
      }
    } catch (e) {
      console.log('Lỗi cập nhật isHeadless từ backend', e);
    }

    const config = {
      ...body,
      isHeadless: finalIsHeadless,
      token,
      apiUrl: process.env.NEXT_PUBLIC_API_URL
    };

    if (!globalThis.veo3Process?.isRunning) {
      globalThis.veo3Process!.logs = [];
      globalThis.veo3Process!.isRunning = true;
      globalThis.veo3Process!.listeners.clear();

      const scriptPath = path.join(process.cwd(), 'src', 'lib', 'veo3-extension', 'batch_run.js');
      const processCwd = path.join(process.cwd(), 'src', 'lib', 'veo3-extension');

      const child = spawn('node', [scriptPath, JSON.stringify(config)], {
        cwd: processCwd
      });

      globalThis.veo3Process!.child = child;

      const logHandler = (line: string) => {
        if (line.trim()) {
          const logMsg = line.trim();
          globalThis.veo3Process!.logs.push(logMsg);
          if (globalThis.veo3Process!.logs.length > 1000) {
            globalThis.veo3Process!.logs.shift();
          }
          globalThis.veo3Process!.listeners.forEach((listener) => {
            listener(logMsg);
          });
        }
      };

      const rlStdout = readline.createInterface({ input: child.stdout });
      rlStdout.on('line', logHandler);

      const rlStderr = readline.createInterface({ input: child.stderr });
      rlStderr.on('line', (line) => logHandler('[LỖI] ' + line));

      child.on('close', (code) => {
        logHandler(`[HỆ THỐNG] Quá trình kết thúc.`);
        logHandler('[DONE]');
        globalThis.veo3Process!.isRunning = false;
        globalThis.veo3Process!.child = null;
        globalThis.veo3Process!.listeners.clear();
      });
    }

    // Build the ReadableStream response
    const stream = new ReadableStream({
      start(controller) {
        const safeEnqueue = (msg: string) => {
          try { controller.enqueue(new TextEncoder().encode(msg)); } catch (e) {}
        };

        // Stream all previous logs instantly to client
        if (globalThis.veo3Process && globalThis.veo3Process.logs.length > 0) {
          for (const log of globalThis.veo3Process.logs) {
            if (log === '[DONE]') continue;
            safeEnqueue(`data: ${JSON.stringify({ log })}\n\n`);
          }
        } else {
          safeEnqueue(`data: ${JSON.stringify({ log: 'Đang khởi động tiến trình Veo3 Automation...' })}\n\n`);
        }

        const listener = (newLog: string) => {
          if (newLog === '[DONE]') {
            safeEnqueue('data: [DONE]\n\n');
            try { controller.close(); } catch (e) {}
          } else {
            safeEnqueue(`data: ${JSON.stringify({ log: newLog })}\n\n`);
          }
        };

        globalThis.veo3Process!.listeners.add(listener);

        // When request is aborted, just remove listener (Do not kill the child process!)
        req.signal.addEventListener('abort', () => {
          globalThis.veo3Process?.listeners.delete(listener);
          try { controller.close(); } catch (e) {}
        });
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
