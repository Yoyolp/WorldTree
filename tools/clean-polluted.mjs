/**
 * 清理历史里被写坏的助手消息。
 *
 * 早期版本在小模型不输出 <<<WT_META>>> 标记时，会把裸 JSON 和
 * `>>>` 选项行一起存进 content。这些内容会回灌给模型，被它当成
 * 「标准格式」继续模仿。本脚本把它们清洗掉。
 *
 * 用法：
 *   node tools/clean-polluted.mjs --dry     # 只看会改哪些（默认）
 *   node tools/clean-polluted.mjs --apply   # 真正写入
 */
import { DatabaseSync } from 'node:sqlite';
import { splitMetaLoose, extractChoiceLines } from '../packages/shared/src/protocol.ts';

const DB = 'D:\\WorldTree\\apps\\server\\data\\worldtree.db';
const apply = process.argv.includes('--apply');

const db = new DatabaseSync(DB);

const rows = db
  .prepare('SELECT id, session_id, content, meta_json FROM messages WHERE role = ? ORDER BY created_at')
  .all('assistant');

let dirty = 0;

for (const r of rows) {
  const content = String(r.content ?? '');
  const hasBareJson = /"(choices|scene|state)"\s*:/.test(content);
  const hasChoiceLine = /^[ \t]*(?:>{2,}|选项[:：])\s*/m.test(content);
  const hasMarker = content.includes('WT_META');

  if (!hasBareJson && !hasChoiceLine && !hasMarker) continue;

  dirty++;
  const parsed = splitMetaLoose(content);
  const cleaned = parsed.text || content;

  // 正文里如果只剩空白，说明整条都是元数据，保留原文更安全
  const next = cleaned.trim() ? cleaned.trim() : content;

  console.log('─'.repeat(60));
  console.log('id:', r.id, '| session:', r.session_id);
  console.log('  原长度:', content.length, '→ 新长度:', next.length);
  console.log('  含裸 JSON:', hasBareJson, '| 含 >>> 行:', hasChoiceLine, '| 含标记:', hasMarker);
  if (parsed.meta?.choices?.length) {
    console.log('  从残骸里救回选项:', parsed.meta.choices.map((c) => c.text).join(' | '));
  }
  console.log('  新正文尾部:', JSON.stringify(next.slice(-60)));

  if (!apply) continue;

  const meta = JSON.parse(r.meta_json || '{}');
  if (parsed.meta?.choices?.length && !meta.choices?.length) {
    meta.choices = parsed.meta.choices.map((c, i) => ({
      id: `recovered_${i}`,
      text: String(c.text ?? '').slice(0, 80),
      hint: c.hint,
      check: c.check?.skill ? { skill: c.check.skill, difficulty: c.check.difficulty ?? 'regular' } : undefined,
    }));
  }
  if (parsed.meta?.scene && !meta.scene) meta.scene = parsed.meta.scene;
  meta.repairedAt = Date.now();

  db.prepare('UPDATE messages SET content = ?, meta_json = ? WHERE id = ?').run(
    next,
    JSON.stringify(meta),
    r.id,
  );
}

console.log('─'.repeat(60));
console.log(`扫描 ${rows.length} 条助手消息，其中 ${dirty} 条需要清理。`);
console.log(apply ? '✅ 已写入数据库。' : 'ℹ️  这是预演。加 --apply 真正写入。');

db.close();
