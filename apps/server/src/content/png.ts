import { deflateSync } from 'node:zlib';
import { embedCharaInPng, toSTCard, type CharacterCard } from '@worldtree/shared';
import { readBinaryFile } from '../env.js';

/**
 * 生成一张纯色 PNG（用作角色卡头像底板），再把 ST V2 数据塞进 tEXt chunk。
 * 这样导出的就是 SillyTavern 能直接吃进的角色卡 PNG。
 */

const PNG_SIG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const TABLE = crcTable();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return [79, 111, 82];
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

/** 生成 size×size 的纯色 PNG */
export function solidColorPng(hex: string, size = 256): Uint8Array {
  const [r, g, b] = hexToRgb(hex);

  // 每行：1 字节 filter(=0) + size*3 字节 RGB
  const rowLen = 1 + size * 3;
  const raw = new Uint8Array(rowLen * size);
  for (let y = 0; y < size; y++) {
    const offset = y * rowLen;
    raw[offset] = 0;
    for (let x = 0; x < size; x++) {
      const p = offset + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = new Uint8Array(deflateSync(raw));

  const parts = [PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * 角色卡 → ST V2 PNG
 *
 * 有头像图片且是 PNG 时，用它当底图 —— 导出的卡片在 SillyTavern 里
 * 就直接显示角色立绘，而不是一块纯色。其它格式（jpg/webp）没法嵌 tEXt
 * 进原图，只能回落到纯色底。
 */
export function characterToPng(card: CharacterCard, size = 256): Uint8Array {
  const json = JSON.stringify(toSTCard(card));

  const fromAvatar = readAvatarPng(card.avatarImage);
  if (fromAvatar) {
    try {
      return embedCharaInPng(fromAvatar, json);
    } catch {
      /* 图损坏就回落到纯色底 */
    }
  }

  const base = solidColorPng(card.avatarColor || '#4f6f52', size);
  return embedCharaInPng(base, json);
}

/** 读取角色头像 PNG 字节；不存在或不是 PNG 返回 null */
function readAvatarPng(rel?: string | null): Uint8Array | null {
  if (!rel || !rel.toLowerCase().endsWith('.png')) return null;
  try {
    const bytes = readBinaryFile(rel);
    // PNG 魔数
    if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
    return bytes;
  } catch {
    return null;
  }
}
