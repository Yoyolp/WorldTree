/**
 * SillyTavern V2 角色卡 / 世界书 双向转换
 *
 * 角色卡 V2 规范：
 *   { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description, personality,
 *     scenario, first_mes, mes_example, creator_notes, system_prompt,
 *     post_history_instructions, alternate_greetings, tags, creator,
 *     character_version, extensions } }
 *
 * PNG 角色卡：在 PNG 的 tEXt chunk 里以 base64 存 JSON，关键字 `chara`。
 */

import type { CharacterCard, WorldBook, WorldBookEntry } from './types.js';

/* ------------------------------------------------------------------ */
/* 角色卡 ⇄ ST V2                                                      */
/* ------------------------------------------------------------------ */

export interface STCharacterData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
}

export interface STCharacterCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: STCharacterData;
}

/** 世界树角色卡 → ST V2 */
export function toSTCard(card: CharacterCard): STCharacterCardV2 {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: card.name,
      description: card.description,
      personality: card.personality,
      scenario: card.scenario,
      first_mes: card.firstMes,
      mes_example: card.mesExample,
      creator_notes: card.creatorNotes,
      system_prompt: card.systemPrompt,
      post_history_instructions: card.postHistoryInstructions,
      alternate_greetings: card.alternateGreetings ?? [],
      tags: card.tags ?? [],
      creator: card.creator ?? '',
      character_version: card.characterVersion ?? '1.0',
      extensions: {
        ...card.extensions,
        // 本平台扩展放进 extensions，其它工具会原样保留
        worldtree: {
          avatarIcon: card.avatarIcon,
          avatarColor: card.avatarColor,
          // 头像图片随卡导出（路径指向 content/assets/，换实例时需要一起拷贝）
          avatarImage: card.avatarImage ?? null,
          isPlayer: card.isPlayer,
          sheet: card.sheet,
          // 能力（金手指/天赋/技能）必须一起带出去，否则导回平台时全部丢失
          abilities: card.abilities,
          characterBookId: card.characterBookId ?? null,
        },
      },
    },
  };
}

/** ST V2 → 世界树角色卡 */
export function fromSTCard(raw: unknown, fallbackId: string): { card: CharacterCard; warnings: string[] } {
  const warnings: string[] = [];
  const obj = raw as Partial<STCharacterCardV2> & Partial<STCharacterData>;
  const data: Partial<STCharacterData> = (obj.data ?? obj) as Partial<STCharacterData>;

  if (obj.spec && obj.spec !== 'chara_card_v2') {
    warnings.push(`角色卡 spec 为 ${obj.spec}，按 V2 结构尝试解析`);
  }
  if (!data.name) warnings.push('角色卡缺少 name 字段');

  const ext = (data.extensions ?? {}) as Record<string, unknown>;
  const wt = (ext.worldtree ?? {}) as Record<string, unknown>;

  const now = Date.now();
  const card: CharacterCard = {
    id: fallbackId,
    spec: 'chara_card_v2',
    specVersion: '2.0',
    name: String(data.name ?? '未命名角色'),
    description: String(data.description ?? ''),
    personality: String(data.personality ?? ''),
    scenario: String(data.scenario ?? ''),
    firstMes: String(data.first_mes ?? data.first_mes ?? ''),
    mesExample: String(data.mes_example ?? ''),
    creatorNotes: String(data.creator_notes ?? ''),
    systemPrompt: String(data.system_prompt ?? ''),
    postHistoryInstructions: String(data.post_history_instructions ?? ''),
    alternateGreetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.map(String) : [],
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    creator: String(data.creator ?? ''),
    characterVersion: String(data.character_version ?? '1.0'),
    extensions: ext,
    avatarIcon: typeof wt.avatarIcon === 'string' ? wt.avatarIcon : 'person',
    avatarColor: typeof wt.avatarColor === 'string' ? wt.avatarColor : '#4f6f52',
    avatarImage: typeof wt.avatarImage === 'string' && wt.avatarImage ? wt.avatarImage : null,
    isPlayer: Boolean(wt.isPlayer),
    sheet: wt.sheet as CharacterCard['sheet'],
    abilities: Array.isArray(wt.abilities) ? (wt.abilities as CharacterCard['abilities']) : undefined,
    characterBookId: (wt.characterBookId as string | null) ?? null,
    createdAt: now,
    updatedAt: now,
  };

  return { card, warnings };
}

/* ------------------------------------------------------------------ */
/* 世界书 ⇄ ST World Info                                              */
/* ------------------------------------------------------------------ */

export interface STWorldInfoEntry {
  uid?: number;
  key: string[];
  keysecondary?: string[];
  comment?: string;
  content: string;
  constant?: boolean;
  vectorized?: boolean;
  selective?: boolean;
  selectiveLogic?: number;
  addMemo?: boolean;
  order?: number;
  position?: number;
  disable?: boolean;
  excludeRecursion?: boolean;
  probability?: number;
  useProbability?: boolean;
  depth?: number;
  group?: string;
  groupOverride?: boolean;
  groupWeight?: number;
  scanDepth?: number | null;
  caseSensitive?: boolean | null;
  matchWholeWords?: boolean | null;
  useGroupScoring?: boolean | null;
  automationId?: string;
  role?: number | null;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  extensions?: Record<string, unknown>;
}

export interface STWorldInfo {
  entries: Record<string, STWorldInfoEntry> | STWorldInfoEntry[];
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
}

/** selectiveLogic 数值 → 语义（ST: 0=AND 1=NOT 2=OR） */
function mapSelectiveLogic(v: number | undefined): WorldBookEntry['selectiveLogic'] {
  if (v === 1) return 'not';
  if (v === 2) return 'or';
  return 'and';
}

function unmapSelectiveLogic(v: WorldBookEntry['selectiveLogic']): number {
  if (v === 'not') return 1;
  if (v === 'or') return 2;
  return 0;
}

/** position 数值 → 语义（ST: 0=before_char, 1=after_char） */
function mapPosition(v: number | undefined, depth?: number): WorldBookEntry['position'] {
  if (depth && depth > 0) return 'at_depth';
  if (v === 1) return 'after_char';
  return 'before_char';
}

export function toSTWorldInfo(book: WorldBook): STWorldInfo {
  const entries: Record<string, STWorldInfoEntry> = {};
  book.entries.forEach((e, i) => {
    entries[i] = {
      uid: i,
      key: e.keys,
      keysecondary: e.secondaryKeys,
      comment: e.comment,
      content: e.content,
      constant: e.constant,
      selective: e.selective,
      selectiveLogic: unmapSelectiveLogic(e.selectiveLogic),
      order: e.insertionOrder,
      position: e.position === 'after_char' ? 1 : 0,
      disable: !e.enabled,
      probability: e.probability,
      useProbability: e.useProbability,
      depth: e.depth,
      group: e.group,
      caseSensitive: e.caseSensitive,
      matchWholeWords: e.matchWholeWords,
      sticky: e.sticky,
      cooldown: e.cooldown,
      extensions: {
        worldtree: {
          priority: e.priority,
          useRegex: e.useRegex,
          maxChars: e.maxChars,
          id: e.id,
          // 图片是本地扩展，其它工具会原样保留这层 extensions
          ...(e.image ? { image: e.image } : {}),
          ...(e.imageCaption ? { imageCaption: e.imageCaption } : {}),
        },
      },
    };
  });

  return {
    entries,
    name: book.name,
    description: book.description,
    scan_depth: book.scanDepth,
    token_budget: book.tokenBudget,
    recursive_scanning: book.recursiveScanning,
  };
}

export function fromSTWorldInfo(raw: unknown, fallbackId: string): { book: WorldBook; warnings: string[] } {
  const warnings: string[] = [];
  const obj = raw as Partial<STWorldInfo>;
  const rawEntries = obj.entries;
  const list: STWorldInfoEntry[] = Array.isArray(rawEntries)
    ? rawEntries
    : Object.values(rawEntries ?? {});

  if (!list.length) warnings.push('世界书没有任何条目');

  const entries: WorldBookEntry[] = list.map((e, i) => {
    const ext = (e.extensions?.worldtree ?? {}) as Record<string, unknown>;
    return {
      id: typeof ext.id === 'string' ? ext.id : `entry_${fallbackId}_${i + 1}`,
      comment: e.comment ?? `条目 ${i + 1}`,
      keys: Array.isArray(e.key) ? e.key.map(String) : [],
      secondaryKeys: Array.isArray(e.keysecondary) ? e.keysecondary.map(String) : [],
      selective: e.selective ?? true,
      selectiveLogic: mapSelectiveLogic(e.selectiveLogic),
      constant: e.constant ?? false,
      caseSensitive: e.caseSensitive ?? false,
      useRegex: Boolean(ext.useRegex),
      matchWholeWords: e.matchWholeWords ?? false,
      priority: typeof ext.priority === 'number' ? ext.priority : 100 - i,
      insertionOrder: e.order ?? i,
      position: mapPosition(e.position, e.depth),
      depth: e.depth ?? 0,
      probability: e.probability ?? 100,
      useProbability: e.useProbability ?? false,
      group: e.group ?? '',
      cooldown: e.cooldown ?? 0,
      sticky: e.sticky ?? 0,
      content: e.content ?? '',
      maxChars: typeof ext.maxChars === 'number' ? ext.maxChars : 0,
      enabled: !e.disable,
      // 图片是本平台扩展，从 extensions.worldtree 读回（缺失则为 undefined）
      ...(typeof ext.image === 'string' && ext.image ? { image: ext.image } : {}),
      ...(typeof ext.imageCaption === 'string' && ext.imageCaption ? { imageCaption: ext.imageCaption } : {}),
    };
  });

  const now = Date.now();
  const book: WorldBook = {
    id: fallbackId,
    name: obj.name ?? '导入的世界书',
    description: obj.description ?? '',
    entries,
    scanDepth: obj.scan_depth ?? 6,
    tokenBudget: obj.token_budget ?? 4000,
    recursiveScanning: obj.recursive_scanning ?? false,
    createdAt: now,
    updatedAt: now,
  };

  return { book, warnings };
}

/* ------------------------------------------------------------------ */
/* PNG tEXt chunk 读写                                                 */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 从 PNG 字节里取出 `chara` 字段（base64 的 JSON） */
export function extractCharaFromPng(bytes: Uint8Array): string | null {
  // 校验签名
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;

  while (offset + 8 < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;

    if (type === 'tEXt') {
      const chunk = bytes.subarray(dataStart, dataStart + length);
      const nul = chunk.indexOf(0);
      if (nul > 0) {
        const keyword = new TextDecoder('latin1').decode(chunk.subarray(0, nul));
        if (keyword === 'chara' || keyword === 'ccv3') {
          return new TextDecoder('utf-8').decode(chunk.subarray(nul + 1));
        }
      }
    }
    if (type === 'IEND') break;
    offset = dataStart + length + 4; // + CRC
  }
  return null;
}

/** 把角色卡数据塞进 PNG 的 tEXt chunk（保留原图像数据） */
export function embedCharaInPng(pngBytes: Uint8Array, jsonText: string): Uint8Array {
  const base64 = base64Encode(new TextEncoder().encode(jsonText));
  const keyword = new TextEncoder().encode('chara');
  const value = new TextEncoder().encode(base64);

  const chunkData = new Uint8Array(keyword.length + 1 + value.length);
  chunkData.set(keyword, 0);
  chunkData[keyword.length] = 0;
  chunkData.set(value, keyword.length + 1);

  const chunk = makeChunk('tEXt', chunkData);

  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let offset = 8;
  const iendPos: number[] = [];

  while (offset + 8 < pngBytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      pngBytes[offset + 4],
      pngBytes[offset + 5],
      pngBytes[offset + 6],
      pngBytes[offset + 7],
    );
    if (type === 'IEND') {
      iendPos.push(offset);
      break;
    }
    offset += 12 + length;
  }

  const insertAt = iendPos[0] ?? pngBytes.length;
  const out = new Uint8Array(pngBytes.length + chunk.length);
  out.set(pngBytes.subarray(0, insertAt), 0);
  out.set(chunk, insertAt);
  out.set(pngBytes.subarray(insertAt), insertAt + chunk.length);
  return out;
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** CRC32 表 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64Decode(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
