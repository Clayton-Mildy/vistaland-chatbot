import { createWriteStream } from 'fs';
import { mkdir, rename, rm, stat } from 'fs/promises';
import { randomUUID } from 'crypto';
import { resolve, join } from 'path';
import { pipeline } from 'stream/promises';
import { getConfig } from '../config.js';

// WhatsApp fetches media by link and rejects webp; 16 MB is its video limit.
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

export class MediaError extends Error {
  constructor(public readonly code: 'UNSUPPORTED_TYPE' | 'TOO_LARGE') {
    super(code);
    this.name = 'MediaError';
  }
}

export function mediaDir(): string {
  return resolve(getConfig().MEDIA_DIR);
}

export function publicUrl(name: string): string {
  return `${getConfig().PUBLIC_BASE_URL.replace(/\/+$/, '')}/media/${name}`;
}

type UploadStream = NodeJS.ReadableStream & { truncated?: boolean; resume(): unknown };

export async function saveUpload(file: {
  filename: string;
  mimetype: string;
  stream: UploadStream;
}): Promise<{ url: string; mime: string; filename: string; size: number }> {
  const ext = EXTENSIONS[file.mimetype];
  if (!ext) {
    // Drain it, or the request never finishes.
    file.stream.resume();
    throw new MediaError('UNSUPPORTED_TYPE');
  }
  const dir = mediaDir();
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const tmp = join(dir, `.${id}.part`);
  try {
    await pipeline(file.stream, createWriteStream(tmp));
    // @fastify/multipart stops at its fileSize limit and marks the stream truncated.
    if (file.stream.truncated) throw new MediaError('TOO_LARGE');
    const name = `${id}.${ext}`;
    await rename(tmp, join(dir, name));
    const { size } = await stat(join(dir, name));
    return { url: publicUrl(name), mime: file.mimetype, filename: file.filename, size };
  } finally {
    await rm(tmp, { force: true });
  }
}
