import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { CONTENT_DIR, HOST, PORT, WEB_DIST, ensureDirs } from './env.js';
import { getDb } from './db.js';
import { registerRoutes } from './routes.js';
import { registerAuthRoutes } from './routes.auth.js';
import { registerAssetRoutes } from './routes.assets.js';
import { registerAuth } from './lib/auth.js';
import { ensureAdmin } from './lib/users.js';
import { ensureSeed } from './seed.js';
import { syncAllContentAsync } from './content/store.js';
import { detectContextWindow } from './settings.js';

async function main(): Promise<void> {
  ensureDirs();
  getDb();

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 24 * 1024 * 1024,
  });

  // 允许「声明了 JSON 但 body 为空」的请求（DELETE 常见），
  // 默认 Fastify 会以 FST_ERR_CTP_EMPTY_JSON_BODY 返回 400。
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      const raw = (body as string) ?? '';
      if (!raw.trim()) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await app.register(cors, { origin: true, credentials: true });

  // 确保内置管理员存在。首次创建时把一次性初始密码打到控制台 —— 只打印这一次，
  // 之后拿不到明文（只存 scrypt 哈希）。忘了密码就只能靠 admin 重置或手工改文件。
  const admin = ensureAdmin();
  if (admin.created) {
    app.log.warn('══════════════════════════════════════════════════════');
    app.log.warn('  已创建内置管理员账号');
    app.log.warn(`    账号：admin`);
    app.log.warn(`    初始密码：${admin.initialPassword}`);
    app.log.warn('  请登录后立刻在「设置 → 账号」里修改密码。');
    app.log.warn('  这段密码只显示这一次，服务重启后不再出现。');
    app.log.warn('══════════════════════════════════════════════════════');
  }

  // 鉴权钩子必须在业务路由之前注册，否则某些路由会先被匹配到
  registerAuth(app);
  await registerAuthRoutes(app);
  // 图片资源要在业务路由之前注册：/api/assets/* 是通配路由，
  // 放到后面会被 /api/* 的其它通配规则先吃掉。
  await registerAssetRoutes(app);
  await registerRoutes(app);

  /*
   * 内容图片走独立的静态前缀 /media/，**不经过鉴权**。
   *
   * 两个要点：
   *
   * 1) 为什么免鉴权：<img src> 没法带 Authorization 头。把图片挂在 /api 下，
   *    浏览器拿不到 Bearer token，图会全部裂开。图片本身是内容库的一部分
   *    （所有登录用户都能读角色卡），不暴露存档等私有数据，因此公开只读是安全的。
   *
   * 2) 为什么是 /media/ 而不是 /assets/：Vite 打包产物本身就放在 dist/assets/，
   *    也挂在这个服务器的根前缀下。两个静态插件抢同一个前缀时，先注册的会吃掉
   *    全部请求 —— JS 请求被路由到图片目录，找不到文件就返回 404 JSON，
   *    浏览器于是报「模块的 MIME 类型是 application/json」，整页白屏。
   */
  await app.register(fastifyStatic, {
    root: join(CONTENT_DIR, 'assets'),
    prefix: '/media/',
    decorateReply: false,
    cacheControl: true,
    maxAge: '365d',
  });

  if (existsSync(WEB_DIST)) {
    // 这里保留 decorateReply（默认 true）：setNotFoundHandler 要用 reply.sendFile
    await app.register(fastifyStatic, { root: WEB_DIST, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api')) {
        reply.code(404).send({ error: 'Not Found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  // 首次启动写入示例内容，然后扫描入库
  const seed = ensureSeed();
  if (seed.created) {
    app.log.info(`已写入 ${seed.created} 个示例内容文件 → ${process.env.WORLDTREE_CONTENT ?? 'apps/server/content'}`);
  }

  const health = await syncAllContentAsync();
  app.log.info(
    `内容已加载：世界 ${health.worlds} / 角色 ${health.characters} / 世界书 ${health.worldbooks} / 剧本 ${health.scripts}` +
      ` / 规则包 ${health.rulepacks}（插件 ${health.rulepackPlugins}）`,
  );
  for (const e of health.errors) app.log.warn(`内容错误 [${e.file}] ${e.message}`);
  for (const w of health.warnings) app.log.info(`内容提示 [${w.file}] ${w.message}`);

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`世界树服务已启动 → http://127.0.0.1:${PORT}`);

  // 主动问一次本地推理服务「你有多少上下文」。用户填的数字经常对不上运行时，
  // 而服务端超限是静默截断 —— 表现就是「输出越来越短、选项丢失」。
  void detectContextWindow(true)
    .then((probe) => {
      if (probe) app.log.info(`上下文探测：${probe.window} tokens（${probe.source}）`);
      else app.log.info('上下文探测：未识别本地推理服务，按设置里的数字裁剪');
    })
    .catch(() => {
      /* 探测失败不影响启动 */
    });
  if (HOST === '0.0.0.0') {
    const nets = networkInterfaces();
    const lan = Object.values(nets)
      .flat()
      .filter((n): n is NonNullable<typeof n> => !!n && n.family === 'IPv4' && !n.internal)
      .map((n) => n.address);
    for (const ip of lan) {
      app.log.info(`局域网访问 → http://${ip}:${PORT}  （同一 Wi-Fi 下的其他设备用这个地址）`);
    }
  }
}

main().catch((err) => {
  console.error('启动失败：', err);
  process.exit(1);
});

