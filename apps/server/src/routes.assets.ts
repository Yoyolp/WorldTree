/**
 * 世界树 · 内容图片（assets）
 *
 * 角色头像、世界书配图都走这里：
 *
 *   POST   /api/assets            上传（base64），返回相对路径 assets/xxx.png
 *   DELETE /api/assets/<path>     删除（仅 admin）
 *   GET    /api/assets            统计（排障用）
 *
 * **读图不走这里**：content/assets 由 index.ts 用 @fastify/static 挂在
 * 免鉴权前缀 /media/ 下 —— <img src> 没法携带 Bearer 头，挂在 /api 下会全裂。
 * （用 /media/ 而不是 /assets/，是因为 Vite 打包产物占了 dist/assets/。）
 *
 * 为什么用 base64 而不是 multipart：
 * 项目没有引入 @fastify/multipart，而 PNG 角色卡导入本来就是 base64，
 * 复用同一条通路不需要新增依赖。前端负责把 File 转成 base64。
 *
 * 图片存在 content/assets/ 下，跟其它内容一样是「文件即真源」，
 * 可以直接用资源管理器/git 管理，也可以拷到别的实例。
 */

import type { FastifyInstance } from 'fastify';
import { existsSync, statSync } from 'node:fs';
import { IMAGE_EXTS, contentPath, removeFile, safeFilename, writeBinaryFile } from './env.js';
import { requireAdmin } from './lib/auth.js';
import { shortId } from '@worldtree/shared';

/** 单张图片上限：8MB（base64 之后约 11MB，与 bodyLimit 24MB 相容） */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** 从 data URL 或裸 base64 里取出 MIME 与数据 */
function parseImagePayload(raw: string): { mime: string; data: Buffer } {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(raw);
  if (m) return { mime: m[1].toLowerCase(), data: Buffer.from(m[2], 'base64') };
  return { mime: '', data: Buffer.from(raw, 'base64') };
}

/** MIME → 扩展名（拿不到 MIME 时按 PNG 兜底） */
function extFromMime(mime: string): string {
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.png';
}

/**
 * 校验 assets 相对路径合法：
 * 必须以 assets/ 开头、扩展名在白名单内、不含路径穿越。
 */
function assertAssetPath(rel: string): void {
  if (!rel.startsWith('assets/')) throw new Error('非法图片路径');
  if (rel.includes('..') || rel.includes('\\')) throw new Error('非法图片路径');
  const lower = rel.toLowerCase();
  if (!IMAGE_EXTS.some((e) => lower.endsWith(e))) throw new Error('不支持的图片格式');
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  /** 上传：body = { data: 'data:image/png;base64,...', prefix?: 'chr' } */
  app.post('/api/assets', async (req, reply) => {
    const body = (req.body ?? {}) as { data?: string; base64?: string; prefix?: string };
    const raw = body.data ?? body.base64;
    if (!raw || typeof raw !== 'string') {
      return reply.code(400).send({ error: '缺少图片数据' });
    }

    const { mime, data } = parseImagePayload(raw);
    if (!data.length) return reply.code(400).send({ error: '图片数据为空' });
    if (data.length > MAX_IMAGE_BYTES) {
      return reply.code(413).send({ error: `图片太大（${(data.length / 1024 / 1024).toFixed(1)}MB，上限 8MB）` });
    }

    // 简单的魔数校验：别把任意文件改名成 .png 塞进来
    const isPng = data.length > 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
    const isJpg = data.length > 3 && data[0] === 0xff && data[1] === 0xd8;
    const isGif = data.length > 6 && data.subarray(0, 3).toString('ascii') === 'GIF';
    const isWebp =
      data.length > 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
    if (!isPng && !isJpg && !isGif && !isWebp) {
      return reply.code(400).send({ error: '无法识别为图片（支持 PNG / JPEG / WebP / GIF）' });
    }

    // 文件名带随机段：避免同一秒内多次上传互相覆盖
    const prefix = (body.prefix ?? 'img').replace(/[^\w-]/g, '').slice(0, 16) || 'img';
    const ext = mime ? extFromMime(mime) : isJpg ? '.jpg' : isGif ? '.gif' : isWebp ? '.webp' : '.png';
    const stem = safeFilename(`${prefix}-${shortId('')}`, ext);
    const rel = `assets/${stem}`;

    writeBinaryFile(rel, new Uint8Array(data));
    return { path: rel, size: data.length };
  });

  /*
   * 读图不在这里做：content/assets 由 index.ts 以 @fastify/static
   * 挂在免鉴权前缀 /media/ 下（<img src> 带不了 Bearer 头）。
   * 这个文件只负责上传、删除与统计。
   */

  /** 删除图片：仅 admin（避免普通用户误删别人的角色头像） */
  app.delete<{ Params: { '*': string } }>('/api/assets/*', async (req, reply) => {
    requireAdmin(req);
    const rel = `assets/${req.params['*']}`;
    try {
      assertAssetPath(rel);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    removeFile(rel);
    return { ok: true };
  });

  /** 头像/配图统计（排障用：assets 目录有多大） */
  app.get('/api/assets', async () => {
    const dir = contentPath('assets');
    if (!existsSync(dir)) return { count: 0, bytes: 0 };
    const { readdirSync } = await import('node:fs');
    const names = readdirSync(dir).filter((n) => IMAGE_EXTS.some((e) => n.toLowerCase().endsWith(e)));
    let bytes = 0;
    for (const n of names) {
      try {
        bytes += statSync(`${dir}/${n}`).size;
      } catch {
        /* 并发删除，忽略 */
      }
    }
    return { count: names.length, bytes };
  });
}
