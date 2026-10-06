/**
 * Client-side image handling for "Import from Photo".
 *
 * Everything stays in browser memory: the file is decoded, downscaled/re-encoded on a canvas and kept as a
 * Blob + object URL purely for the preview. Nothing touches localStorage / IndexedDB / Cache Storage.
 */
import { ALLOWED_MIME_TYPES, MAX_ORIGINAL_BYTES, MAX_SEND_BYTES, type ImportErrorCode } from './types';

export interface PreparedImage {
  /** Compressed JPEG (what is sent to the server and shown as preview). */
  blob: Blob;
  mimeType: 'image/jpeg';
  /** Temporary object URL for <img>. MUST be revoked via `releaseImage`. */
  previewUrl: string;
  width: number;
  height: number;
}

export function validateImageFile(file: { type: string; size: number }): ImportErrorCode | null {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) return 'unsupportedType';
  if (file.size > MAX_ORIGINAL_BYTES) return 'imageTooLarge';
  if (file.size === 0) return 'invalidImage';
  return null;
}

/** Scale so that the longest side is at most `maxSide` (never upscales). */
export function computeScaledSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const ratio = maxSide / longest;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

/**
 * Sequence of (maxSide, quality) attempts, from best readability to smallest.
 * Mark lists are text heavy, so resolution is reduced only after quality has been lowered a little.
 */
export const COMPRESSION_STEPS: { maxSide: number; quality: number }[] = [
  { maxSide: 2400, quality: 0.86 },
  { maxSide: 2200, quality: 0.8 },
  { maxSide: 2000, quality: 0.75 },
  { maxSide: 1700, quality: 0.72 },
  { maxSide: 1400, quality: 0.7 },
];

async function decode(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      // imageOrientation 'from-image' applies EXIF rotation from phone cameras
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const problem = validateImageFile(file);
  if (problem) throw Object.assign(new Error(problem), { code: problem });

  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw Object.assign(new Error('invalidImage'), { code: 'invalidImage' as ImportErrorCode });
  }

  try {
    let best: { blob: Blob; width: number; height: number } | null = null;
    for (const step of COMPRESSION_STEPS) {
      const size = computeScaledSize(decoded.width, decoded.height, step.maxSide);
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.fillStyle = '#ffffff'; // flatten transparency (PNG/WebP) onto white for OCR
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(decoded.source, 0, 0, size.width, size.height);
      const blob = await canvasToBlob(canvas, step.quality);
      // release canvas pixels as soon as possible
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) continue;
      best = { blob, width: size.width, height: size.height };
      if (blob.size <= MAX_SEND_BYTES) break;
    }
    if (!best || best.blob.size > MAX_SEND_BYTES) {
      throw Object.assign(new Error('imageTooLarge'), { code: 'imageTooLarge' as ImportErrorCode });
    }
    return {
      blob: best.blob,
      mimeType: 'image/jpeg',
      previewUrl: URL.createObjectURL(best.blob),
      width: best.width,
      height: best.height,
    };
  } finally {
    decoded.close();
  }
}

/** Blob → base64 string (no data-URL prefix). Exists only for the duration of the request. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

/** Drop the temporary image reference. */
export function releaseImage(image: PreparedImage | null): void {
  if (image) URL.revokeObjectURL(image.previewUrl);
}
