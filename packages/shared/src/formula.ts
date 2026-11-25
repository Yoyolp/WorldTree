/**
 * 世界树 · 受限表达式求值
 *
 * 规则书需要表达「HP 上限 = (CON+SIZ)/10」「AC = 10 + 敏捷调整值」这类派生关系。
 * 三条路可选：
 *
 *   a) 让插件直接给一个函数 —— 最灵活，但纯数据的 JSON 规则书就没法用；
 *   b) 用 `eval` / `new Function` —— 一行搞定，但等于把规则书变成任意代码执行点；
 *   c) 自己写一个只有四则运算和几个数学函数的解析器 —— 就是这里。
 *
 * 选 (c)。表达式里只能出现数字、四则运算、括号、`min/max/floor/ceil/round/abs`
 * 以及调用方传进来的变量名，不存在属性访问、函数调用逃逸或原型链操作。
 *
 * 两个入口：
 *   evaluateFormula(expr, vars)      纯算术
 *   rollExpression(expr, rng)        支持 NdM 骰式，如 "3d6*5"、"1d8+2"
 */

/** 求值失败的原因，便于把错误提示回给规则书作者 */
export type FormulaError =
  | 'empty'
  | 'bad-token'
  | 'unbalanced'
  | 'unknown-name'
  | 'not-a-number'
  | 'div-by-zero';

export interface FormulaResult {
  /** 成功时的值 */
  value?: number;
  /** 失败原因 */
  error?: FormulaError;
  /** 出错字符位置（尽量给） */
  at?: number;
  /** 未知的变量名 */
  name?: string;
}

/* ------------------------------------------------------------------ */
/* 词法                                                                */
/* ------------------------------------------------------------------ */

type Token =
  | { t: 'num'; v: number; i: number }
  | { t: 'name'; v: string; i: number }
  | { t: 'op'; v: string; i: number };

const OPS = new Set(['+', '-', '*', '/', '%', '(', ')', ',']);

function tokenize(src: string): { tokens: Token[]; error?: FormulaResult } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (OPS.has(ch)) {
      tokens.push({ t: 'op', v: ch, i });
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      const start = i;
      while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
      // 小数点（只允许 0.5 这种，不接受 .5）
      if (src[i] === '.' && src[i + 1] >= '0' && src[i + 1] <= '9') {
        i++;
        while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
      }
      const text = src.slice(start, i);
      const v = Number(text);
      if (!Number.isFinite(v)) return { tokens: [], error: { error: 'not-a-number', at: start } };
      tokens.push({ t: 'num', v, i: start });
      continue;
    }
    // 标识符：字母、下划线、数字、点（允许 `NPC.AC` 这种写法，点会被换成下划线查表）
    if (/[A-Za-z_\u4e00-\u9fa5]/.test(ch)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_\u4e00-\u9fa5.]/.test(src[i])) i++;
      tokens.push({ t: 'name', v: src.slice(start, i), i: start });
      continue;
    }
    return { tokens: [], error: { error: 'bad-token', at: i } };
  }
  return { tokens };
}

/* ------------------------------------------------------------------ */
/* 语法：递归下降                                                       */
/* ------------------------------------------------------------------ */

/** 内置函数：名字 → 实现 */
const FUNCS: Record<string, (args: number[]) => number> = {
  floor: (a) => Math.floor(a[0] ?? 0),
  ceil: (a) => Math.ceil(a[0] ?? 0),
  round: (a) => Math.round(a[0] ?? 0),
  abs: (a) => Math.abs(a[0] ?? 0),
  min: (a) => Math.min(...a),
  max: (a) => Math.max(...a),
  sign: (a) => Math.sign(a[0] ?? 0),
};

interface Cursor {
  tokens: Token[];
  pos: number;
  vars: Record<string, number>;
  /** 变量的宽松匹配表：大写名 ↔ 原名 */
  lookup: Record<string, number>;
}

class ParseError extends Error {
  constructor(
    public readonly kind: FormulaError,
    public readonly at: number,
    public readonly varName?: string,
  ) {
    super(kind);
  }
}

function peek(c: Cursor): Token | undefined {
  return c.tokens[c.pos];
}

function expectOp(c: Cursor, v: string): void {
  const tok = peek(c);
  if (!tok || tok.t !== 'op' || tok.v !== v) {
    throw new ParseError('unbalanced', tok?.i ?? -1);
  }
  c.pos++;
}

function parseExpression(c: Cursor): number {
  let left = parseTerm(c);
  for (;;) {
    const tok = peek(c);
    if (tok?.t === 'op' && (tok.v === '+' || tok.v === '-')) {
      c.pos++;
      const right = parseTerm(c);
      left = tok.v === '+' ? left + right : left - right;
    } else {
      return left;
    }
  }
}

function parseTerm(c: Cursor): number {
  let left = parseUnary(c);
  for (;;) {
    const tok = peek(c);
    if (tok?.t === 'op' && (tok.v === '*' || tok.v === '/' || tok.v === '%')) {
      c.pos++;
      const right = parseUnary(c);
      if (tok.v === '*') left = left * right;
      else if (tok.v === '/') {
        if (right === 0) throw new ParseError('div-by-zero', tok.i);
        left = left / right;
      } else {
        if (right === 0) throw new ParseError('div-by-zero', tok.i);
        left = left % right;
      }
    } else {
      return left;
    }
  }
}

function parseUnary(c: Cursor): number {
  const tok = peek(c);
  if (tok?.t === 'op' && (tok.v === '-' || tok.v === '+')) {
    c.pos++;
    const v = parseUnary(c);
    return tok.v === '-' ? -v : v;
  }
  return parsePrimary(c);
}

function parsePrimary(c: Cursor): number {
  const tok = peek(c);
  if (!tok) throw new ParseError('unbalanced', -1);

  if (tok.t === 'num') {
    c.pos++;
    return tok.v;
  }

  if (tok.t === 'op' && tok.v === '(') {
    c.pos++;
    const v = parseExpression(c);
    expectOp(c, ')');
    return v;
  }

  if (tok.t === 'name') {
    c.pos++;
    const raw = tok.v;

    // 函数调用：name( ... )
    const next = peek(c);
    if (next?.t === 'op' && next.v === '(') {
      const fn = FUNCS[raw.toLowerCase()];
      if (!fn) throw new ParseError('unknown-name', tok.i, raw);
      c.pos++;
      const args: number[] = [];
      const close = peek(c);
      if (close?.t === 'op' && close.v === ')') {
        c.pos++;
      } else {
        for (;;) {
          args.push(parseExpression(c));
          const sep = peek(c);
          if (sep?.t === 'op' && sep.v === ',') {
            c.pos++;
            continue;
          }
          expectOp(c, ')');
          break;
        }
      }
      return fn(args);
    }

    // 变量
    const v = c.lookup[raw] ?? c.lookup[raw.toUpperCase()];
    if (v === undefined || !Number.isFinite(v)) {
      throw new ParseError('unknown-name', tok.i, raw);
    }
    return v;
  }

  throw new ParseError('bad-token', tok.i);
}

/* ------------------------------------------------------------------ */
/* 对外                                                                */
/* ------------------------------------------------------------------ */

/**
 * 求值。变量名大小写不敏感（`CON` 与 `con` 等价），
 * 也允许 `A.B` 这种写法（按 `A_B` 查表）。
 */
export function evalFormula(expr: string, vars: Record<string, number> = {}): FormulaResult {
  if (typeof expr !== 'string' || !expr.trim()) return { error: 'empty' };

  const { tokens, error } = tokenize(expr);
  if (error) return error;
  if (!tokens.length) return { error: 'empty' };

  const lookup: Record<string, number> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    lookup[k] = v;
    lookup[k.replace(/\./g, '_')] = v;
  }

  const cursor: Cursor = { tokens, pos: 0, vars, lookup };
  try {
    const value = parseExpression(cursor);
    if (cursor.pos !== tokens.length) {
      return { error: 'bad-token', at: tokens[cursor.pos]?.i };
    }
    if (!Number.isFinite(value)) return { error: 'not-a-number' };
    return { value };
  } catch (err) {
    if (err instanceof ParseError) {
      return { error: err.kind, at: err.at, name: err.varName };
    }
    return { error: 'bad-token' };
  }
}

/** 只要值，失败返回 null（渲染路径用这个） */
export function evaluateFormula(expr: string | undefined | null, vars?: Record<string, number>): number | null {
  if (expr === undefined || expr === null) return null;
  const r = evalFormula(expr, vars);
  return r.value === undefined ? null : r.value;
}

/** 把表达式里所有 NdM 骰式展开成掷好的数字（不修改原串） */
export function expandDice(expr: string, rng: () => number): string {
  return expr.replace(/(\d*)[dD](\d+)/g, (_m, countText: string, facesText: string) => {
    const count = Math.max(1, Math.min(100, countText === '' ? 1 : Number(countText) || 1));
    const faces = Math.max(2, Math.min(1000, Number(facesText) || 6));
    let total = 0;
    for (let i = 0; i < count; i++) total += Math.floor(rng() * faces) + 1;
    return String(total);
  });
}

/**
 * 带骰式的求值：先展开 NdM，再按普通表达式算。
 * 例如 "3d6*5"、"1d8+2"、"2d6+floor(CON/2)"。
 *
 * rng 必须由调用方注入（可复现），这里绝不碰 Math.random。
 */
export function evalDiceFormula(
  expr: string,
  vars: Record<string, number> = {},
  rng: () => number,
): FormulaResult {
  if (typeof expr !== 'string' || !expr.trim()) return { error: 'empty' };
  const expanded = expandDice(expr, rng);
  return evalFormula(expanded, vars);
}

/** 求值失败时给规则书作者看的中文说明 */
export function describeFormulaError(r: FormulaResult): string {
  switch (r.error) {
    case 'empty':
      return '公式为空';
    case 'bad-token':
      return `公式含非法字符（位置 ${r.at ?? '?'}）`;
    case 'unbalanced':
      return `括号不配对（位置 ${r.at ?? '?'}）`;
    case 'unknown-name':
      return `未知的名称「${r.name ?? '?'}」`;
    case 'not-a-number':
      return '结果不是有效数字';
    case 'div-by-zero':
      return '除数是 0';
    default:
      return '公式无效';
  }
}
