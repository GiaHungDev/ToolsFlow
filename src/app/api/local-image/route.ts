import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get('path');

  if (!filePath) {
    return new NextResponse('Path is required', { status: 400 });
  }

  // Remove file:// prefix if it exists
  const cleanPath = filePath.replace(/^file:\/\//i, '');

  if (!fs.existsSync(cleanPath)) {
    return new NextResponse(`File not found: ${cleanPath}`, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(cleanPath);
    const ext = path.extname(cleanPath).toLowerCase();
    
    let contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.svg') contentType = 'image/svg+xml';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch (error) {
    return new NextResponse('Error reading file', { status: 500 });
  }
}
