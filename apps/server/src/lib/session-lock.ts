/**
 * 按 key 串行化的简单锁。
 *
 * 为什么需要：一次推演是「读 session.state → 算 → 写回」的非原子过程。
 * 同一世界线被两个请求同时推进时（多标签页、多人房间、网络重试），
 * 两边都读到旧状态，后写覆盖先写，就丢了一次回合的状态变更。
 *
 * 这里用 promise 链做排队：同一个 key 上的任务严格串行，不同 key 之间互不影响。
 * 单进程内存实现即可 —— 本平台就是单进程 Fastify，没有多实例。
 */

/** key → 该 key 队列的尾部 promise */
const tails = new Map<string, Promise<unknown>>();

/**
 * 在 key 的串行队列里执行 fn。
 *
 * 返回值与 fn 一致；fn 抛错只影响本次调用，不会卡住后续任务。
 */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();

  // 排队：等上一个跑完（无论成功失败）再跑自己
  const run = prev.then(fn, fn);

  // 队列尾部登记「已经吞掉异常」的版本，避免一次失败把后面的全带走
  const tail = run.catch(() => undefined);
  tails.set(key, tail);

  // 队列彻底空下来后清理，避免 Map 无限增长（只在自己还是队尾时清）
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });

  return run;
}

/**
 * 手动版：先排队拿到锁，用完后调用返回的 release()。
 *
 * 流式接口（SSE）没法整个包进 withLock —— 它要先吐 header 再长时间 yield。
 * 这时候用 acquire() 在开始前排队，在 finally 里 release()。
 */
export async function acquire(key: string): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(() => gate, () => gate);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);

  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });

  await prev.catch(() => undefined);
  return release;
}
