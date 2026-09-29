import { NextRequest, NextResponse } from 'next/server';
import { storageService } from '../../../../../lib/storage';
import fs from 'fs';
import path from 'path';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ key: string[] }> }
) {
  const { key } = await context.params;
  const storageKey = key.join('/');

  // 1. Try memory or storageService
  const buffer = await storageService.getObject(storageKey);
  if (buffer) {
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': buffer.length.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  // 2. Try disk storage
  const storageDir = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');
  const filePath = path.join(storageDir, ...key);
  if (fs.existsSync(filePath)) {
    const fileStat = fs.statSync(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileStat.size.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  return NextResponse.json({ error: 'File not found' }, { status: 404 });
}
