/**
 * 图片上传工具。
 *
 * 服务端只收 base64（见 routes.assets.ts 的说明），所以这里负责：
 *   1. 读 File → data URL
 *   2. 可选：先在前端压缩/缩放（手机拍的照片动辄 5MB，直接传很浪费）
 *   3. POST /api/assets，拿回 assets/xxx.png
 *
 * 返回的是**相对 content/ 的路径**（assets/xxx.png），
 * 显示时用 assetUrl() 拼成可访问的 URL。
 *
 * 注意前端访问前缀是 `/media/`，不是 `/assets/`：
 * Vite 打包产物占了 dist/assets/ 并挂在根前缀，两者不能撞。
 */

import { api } from '@/api';

/** 单张图片上限，与服务端保持一致 */
export const MAX_IMAGE_MB = 8;

/** 内容图片的前端访问前缀（对应服务端 fastifyStatic 的 prefix） */
export const MEDIA_PREFIX = '/media/';

/** 相对路径 → 可直接放进 <img src> 的 URL */
export function assetUrl(path?: string | null): string {
  if (!path) return '';
  // 已经是完整 URL（外链头像）就原样返回
  if (/^(https?:)?\/\//.test(path) || path.startsWith('data:')) return path;
  // 存储路径统一是 assets/xxx.png，只取文件名拼到 /media/ 下
  const name = path.replace(/^assets\//, '');
  return `${MEDIA_PREFIX}${name}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

/** 用 canvas 缩放并重新编码，控制体积 */
async function downscale(file: File, maxEdge: number, quality: number): Promise<string> {
  const dataUrl = await readAsDataUrl(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解码失败'));
    el.src = dataUrl;
  });

  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  if (scale >= 1 && file.size <= 1.5 * 1024 * 1024) return dataUrl; // 本来就不大，不折腾

  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);

  // PNG 带透明通道就保留 PNG，其它统一转 JPEG 省体积
  const keepPng = file.type === 'image/png' || file.type === 'image/webp';
  return keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
}

export interface UploadOptions {
  /** 文件名前缀，便于在 assets 目录里辨认来源 */
  prefix?: string;
  /** 最长边（像素）。头像 512 足够，配图可以给 1280 */
  maxEdge?: number;
  /** JPEG 质量 0-1 */
  quality?: number;
}

/**
 * 上传一张图片，返回相对路径（assets/xxx.png）。
 * 失败时抛错，调用方自己 toast。
 */
export async function uploadImage(file: File, opts: UploadOptions = {}): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
    throw new Error(`图片超过 ${MAX_IMAGE_MB}MB，请先压缩`);
  }

  const data = await downscale(file, opts.maxEdge ?? 512, opts.quality ?? 0.88);
  const res = await api.uploadAsset(data, opts.prefix ?? 'img');
  return res.path;
}
