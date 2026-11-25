import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');

/** 数据目录：可用 WORLDTREE_DATA 覆盖 */
export const DATA_DIR = process.env.WORLDTREE_DATA
  ? resolve(process.env.WORLDTREE_DATA)
  : join(appRoot, 'data');

/** 内容目录：角色卡/世界书/剧本/世界的源文件 */
export const CONTENT_DIR = process.env.WORLDTREE_CONTENT
  ? resolve(process.env.WORLDTREE_CONTENT)
  : join(appRoot, 'content');

export const DB_FILE = join(DATA_DIR, 'worldtree.db');

/** 前端构建产物 */
export const WEB_DIST = resolve(appRoot, '..', 'web', 'dist');

export const PORT = Number(process.env.PORT ?? 5174);
/**
 * 默认绑定 0.0.0.0：同一局域网的其他设备可以直接访问。
 * 想只允许本机访问时设 HOST=127.0.0.1。
 */
export const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * 内容子目录。
 *
 * assets 存放用户上传的图片（角色头像、世界书配图、世界封面等）。
 * 它不参与「扫描入 SQLite」——图片不被索引，只按路径直接读出来给前端。
 */
export const CONTENT_SUBDIRS = ['worlds', 'characters', 'worldbooks', 'scripts', 'rulepacks', 'assets'] as const;
export type ContentSubdir = (typeof CONTENT_SUBDIRS)[number];

/** assets 下允许的图片扩展名 */
export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'] as const;

export function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  for (const d of CONTENT_SUBDIRS) {
    mkdirSync(join(CONTENT_DIR, d), { recursive: true });
  }
}

/** 相对 content/ 的路径 → 绝对路径，并阻止路径穿越 */
export function contentPath(rel: string): string {
  const abs = resolve(CONTENT_DIR, rel);
  const root = resolve(CONTENT_DIR);
  if (!abs.startsWith(root)) throw new Error(`非法路径：${rel}`);
  return abs;
}

export interface FileEntry {
  /** 相对 content/ 的路径（用 / 分隔） */
  rel: string;
  abs: string;
  mtime: number;
  size: number;
}

/** 列出某子目录下的所有文件 */
export function listContentFiles(sub: ContentSubdir, exts: string[] = ['.json', '.md', '.png']): FileEntry[] {
  const dir = join(CONTENT_DIR, sub);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => exts.some((e) => name.toLowerCase().endsWith(e)))
    .map((name) => {
      const abs = join(dir, name);
      const st = statSync(abs);
      return { rel: `${sub}/${name}`, abs, mtime: st.mtimeMs, size: st.size };
    })
    .filter((f) => !f.abs.endsWith('.gitkeep'));
}

export function readTextFile(rel: string): string {
  return readFileSync(contentPath(rel), 'utf8');
}

export function readBinaryFile(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(contentPath(rel)));
}

export function writeTextFile(rel: string, content: string): void {
  const abs = contentPath(rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

export function writeBinaryFile(rel: string, data: Uint8Array): void {
  const abs = contentPath(rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
}

export function fileExists(rel: string): boolean {
  try {
    return existsSync(contentPath(rel));
  } catch {
    return false;
  }
}

export function removeFile(rel: string): void {
  const abs = contentPath(rel);
  if (existsSync(abs)) rmSync(abs, { force: true });
}

/** 简单内容指纹，用于判断文件是否被外部修改 */
export function checksum(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

/** 文件名安全化 */
export function safeFilename(name: string, ext: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'untitled'}${ext}`;
}
