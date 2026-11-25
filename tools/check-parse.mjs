await import('./_auth-patch.mjs');
/**
 * 元数据解析容错测试
 *
 * 用真实翻车样本验证：
 *   1. 标准标记 → 正常解析
 *   2. 无标记 + 裸 JSON → 仍能解析，且 JSON 不进正文
 *   3. JSON 被截断 → 自动补全括号
 *   4. `>>>` 行内选项 → 剥离并收集
 *   5. 历史净化 → 不把坏格式回灌给模型
 *
 * 用法：node tools/check-parse.mjs
 */
import {
  extractChoiceLines,
  repairTruncatedJson,
  splitMetaLoose,
  splitMetaStrict,
  stripMetaStreaming,
} from '../packages/shared/src/protocol.ts';
import { cleanHistoryText } from '../apps/server/src/llm/prompt.ts';

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
};

/* ------------------------------------------------------------------ */
console.log('\n[1] 标准标记');

const standard = `雾从缝隙里渗出来。

<<<WT_META>>>
{"choices":[{"text":"推门"},{"text":"退回去"}],"scene":"雾中的门"}
<<<END_META>>>`;

const s1 = splitMetaLoose(standard);
ok('解析出正文', s1.text === '雾从缝隙里渗出来。', JSON.stringify(s1.text));
ok('解析出 2 个选项', s1.meta?.choices?.length === 2);
ok('未走兜底', s1.recovered === false);
ok('严格模式也能解析', !!splitMetaStrict(standard).meta);

/* ------------------------------------------------------------------ */
console.log('\n[2] 无标记 + 裸 JSON（真实翻车样本）');

const bare = `你握紧怀表。列车员抬手，指尖是两截断裂的金属管。

>>> 把怀表递给他 / 用牙齿咬碎怀表 / 冲向连接门

{
  "choices": [
    {"text": "把怀表递给他", "hint": "可能触发转折"},
    {"text": "用牙齿咬碎怀表"}
  ],
  "scene": "第四节车厢"
}`;

const s2 = splitMetaLoose(bare);
ok('正文里没有 JSON', !s2.text.includes('"choices"'), s2.text.slice(-40));
ok('正文里没有 >>> 行', !s2.text.includes('>>>'));
ok('兜底解析出选项', s2.meta?.choices?.length === 2);
ok('标记为走了兜底', s2.recovered === true);

/* ------------------------------------------------------------------ */
console.log('\n[3] JSON 被上下文截断');

const truncated = `列车员转过身来。

{
  "choices": [
    {"text": "把怀表递给他"},
    {"text": "用牙齿咬碎怀表"},
    {"text": "冲向连接门"}
  ],
  "check": {"result": "success"},
  "state": {"set": {"location": "第四节车厢"}},
  "scene": "`;

const s3 = splitMetaLoose(truncated);
ok('截断的 JSON 也能解析', !!s3.meta, s3.meta ? 'ok' : 'null');
ok('选项没丢', s3.meta?.choices?.length === 3, String(s3.meta?.choices?.length));
ok('正文干净', !s3.text.includes('"choices"'), s3.text.slice(-30));

const repaired = repairTruncatedJson('{"a":1,"b":[1,2],"c":"半截');
ok('修复器能补齐括号与引号', !!repaired, repaired ?? 'null');

/* ------------------------------------------------------------------ */
console.log('\n[4] 行内选项剥离');

const inline = `他沉默了一会儿。

>>> 追问下去 / 转身离开 / 掏出怀表`;
const s4 = extractChoiceLines(inline);
ok('剥掉 >>> 行', !s4.text.includes('>>>'), JSON.stringify(s4.text));
ok('收集到 3 个选项', s4.choices.length === 3, s4.choices.join(' | '));

const inline2 = `选项：接受交易 / 拒绝交易`;
const s5 = extractChoiceLines(inline2);
ok('也认「选项：」写法', s5.choices.length === 2, s5.choices.join(' | '));

/* ------------------------------------------------------------------ */
console.log('\n[5] 流式时不显示裸 JSON');

const streaming = '叙事正文。\n{\n  "choices": [{"text": "还没写完';
const stripped = stripMetaStreaming(streaming);
ok('流式剥离未完成的 JSON', !stripped.includes('"choices"'), JSON.stringify(stripped));

/* ------------------------------------------------------------------ */
console.log('\n[5.5] 标记写了但 JSON 没写完');

const halfMeta = `叙事正文到这里。

<<<WT_META>>>
{"choices": [{"text": "`;

const s6 = splitMetaLoose(halfMeta);
ok('标记之后的内容不显示', !s6.text.includes('WT_META') && !s6.text.includes('"choices"'), JSON.stringify(s6.text));
ok('正文保留', s6.text.includes('叙事正文到这里'));

/* ------------------------------------------------------------------ */
console.log('\n[6] 历史净化');

const pollutedHistory = `正文一段。

>>> 选项A / 选项B

{"choices":[{"text":"选项A"}],"scene":"某处"}`;
const cleaned = cleanHistoryText(pollutedHistory);
ok('历史里不再有 JSON', !cleaned.includes('"choices"'), JSON.stringify(cleaned));
ok('历史里不再有 >>> 行', !cleaned.includes('>>>'));
ok('正文保留', cleaned.includes('正文一段'));

/* ------------------------------------------------------------------ */
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
