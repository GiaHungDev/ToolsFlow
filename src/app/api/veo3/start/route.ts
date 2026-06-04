import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = req.headers.get('authorization');
    
    // Chuyển tiếp Request xuống Local Express API đang chạy ở Electron Main
    const response = await fetch('http://127.0.0.1:52424/api/veo3/start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': token } : {})
      },
      body: JSON.stringify(body),
    });

    // Proxy toàn bộ Headers (bao gồm cả SSE Headers) và Body stream về Client
    const headers = new Headers();
    response.headers.forEach((val, key) => headers.set(key, val));

    return new NextResponse(response.body, {
      status: response.status,
      headers: headers
    });
  } catch (error: any) {
    console.error('Lỗi khi gọi Local Express API:', error);
    return NextResponse.json({ error: 'Không thể kết nối đến Local Automation Service' }, { status: 500 });
  }
}
