import { createServer } from 'node:http';

// 模拟 OpenAI 兼容的流式接口，用于离线验证世界树的推演链路
const server = createServer((req, res) => {
  if (req.url?.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-storyteller' }] }));
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const lastUser = [...(payload.messages ?? [])].reverse().find((m) => m.role === 'user');
    const p = lastUser?.content ?? '';
    const isCoc = p.includes('跑团') || p.includes('检定');

    const narrative =
      `雾从木板的缝隙里渗出来，像有人在下面缓慢地呼吸。\n\n` +
      `你停在第七码仓库的门前。门内传来三次极轻的敲击——间隔均匀得不像人手。\n\n` +
      `「……你终于来了。」一个沙哑的声音说，然后门开了一条缝。\n\n` +
      `你能看见里面站着一个人影，正在把什么东西塞进铅制的箱子里。`;

    const meta = {
      choices: [
        { text: '推门而入，看清那个人' },
        { text: '退到雾里，等他出来' },
        { text: '敲三下门，回应他', check: { skill: '心理学', difficulty: 'regular' } },
      ],
      check: isCoc ? { skill: '侦查', difficulty: 'regular', reason: '雾太浓，需要看清门牌' } : null,
      state: { set: { 码头: '七号仓库', 时间: '凌晨两点' }, addFlags: ['见过守门人'], sanDelta: isCoc ? -2 : 0 },
      scene: '七号仓库门前',
      summary: '玩家抵达仓库，与守门人初次照面。',
    };

    const full = `${narrative}\n\n<<<WT_META>>>\n${JSON.stringify(meta)}\n<<<END_META>>>`;

    if (!payload.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: full } }] }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const chars = [...full];
    let i = 0;
    const tick = setInterval(() => {
      if (i >= chars.length) {
        clearInterval(tick);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const step = 6;
      const piece = chars.slice(i, i + step).join('');
      i += step;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    }, 12);
  });
});

server.listen(5999, '127.0.0.1', () => console.log('mock llm on 5999'));
