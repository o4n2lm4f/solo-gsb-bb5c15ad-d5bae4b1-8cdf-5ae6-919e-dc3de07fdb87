import type { ArticleSignoff, ClauseNode } from '../../shared/model';
import { uid } from './uid';

/** 条款审签内容指纹算法版本；算法变更时递增，旧记录将自动判为待重签 */
export const SIGNFP_VERSION = 'v1';

/**
 * cyrb53：短小确定性 53 位字符串哈希（与具体 JS 引擎无关的整数运算实现）。
 * 审签指纹只用于“签署时条文 vs 当前条文”的同一性判断，两个不同种子的哈希
 * 拼接为 106 位指纹，碰撞概率可忽略。
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return combined.toString(16).padStart(14, '0');
}

/**
 * 把一条的完整条文（条号、条序号后缀、标题、条头正文、全部款及其项）
 * 规范序列化为稳定的纯文本表示。
 *
 * - 条号取结构 ordinal（即当前条在文档中的位置），结构调整（增删 / 拖拽 / 换号）
 *   会使位置变化的条指纹改变；
 * - 款、项编号按其结构位置（从 1 开始）给出，项的增删移动同样改变所属条指纹；
 * - 逐字符精确比较，正文或标题的任何编辑都会改变指纹。
 */
export function serializeArticle(article: ClauseNode): string {
  const lines: string[] = [];
  lines.push(`ARTICLE ${article.ordinal}${article.suffix ? ` SUFFIX ${article.suffix}` : ''}`);
  lines.push(`TITLE ${article.title ?? ''}`);
  lines.push(`TEXT ${article.text}`);
  article.children.forEach((paragraph, pi) => {
    lines.push(`P ${pi + 1} TEXT ${paragraph.text}`);
    paragraph.children.forEach((item, ii) => {
      lines.push(`P ${pi + 1} I ${ii + 1} TEXT ${item.text}`);
    });
  });
  return lines.join('\n');
}

/** 计算某条当前完整条文的内容指纹（带版本前缀） */
export function articleFingerprint(article: ClauseNode): string {
  const serialized = serializeArticle(article);
  return `${SIGNFP_VERSION}-${cyrb53(serialized, 0x5a17)}${cyrb53(serialized, 0xc0de)}`;
}

/** 由当前条文创建一条新的审签记录（同一条重新签署时以新记录覆盖旧记录） */
export function createSignoff(article: ClauseNode, signer: string, now = Date.now()): ArticleSignoff {
  return {
    id: uid('sign'),
    articleId: article.id,
    signer: signer.trim(),
    signedAt: now,
    fingerprint: articleFingerprint(article),
    fpVersion: SIGNFP_VERSION,
  };
}

export type SignoffStatus = 'unsigned' | 'valid' | 'stale';

/**
 * 当前文档下各审签记录的状态：
 * - valid：条仍存在、指纹算法版本一致且指纹相同（条文未变化）；
 * - stale：条仍存在，但当前条文指纹不同（正文编辑、标题 / 条号变化、结构调整、
 *   引用自动改写等），或记录的指纹算法版本已升级；
 * - unsigned 不出现在这里，由界面按“没有记录的现存条”推导。
 * 已删除条的记录不在结果中（保留数据以支持撤销恢复，但不计入当前统计）。
 */
export function signoffStatusMap(
  articles: ClauseNode[],
  signoffs: ArticleSignoff[],
): Map<string, SignoffStatus> {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const map = new Map<string, SignoffStatus>();
  for (const s of signoffs) {
    const article = byId.get(s.articleId);
    if (!article) continue; // 删除的条：不计入当前统计
    const current = articleFingerprint(article);
    map.set(
      s.articleId,
      s.fpVersion === SIGNFP_VERSION && s.fingerprint === current ? 'valid' : 'stale',
    );
  }
  return map;
}

/**
 * 校验并规整外部数据中的审签记录（旧数据 / 导入文件缺少该字段时返回空列表）。
 * 同一条存在多条记录时仅保留签署时间最新的一条；不校验指纹（状态由当前条文重算）。
 */
export function sanitizeSignoffs(value: unknown): ArticleSignoff[] {
  if (!Array.isArray(value)) return [];
  const latest = new Map<string, ArticleSignoff>();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as Partial<ArticleSignoff>;
    if (typeof s.articleId !== 'string' || !s.articleId) continue;
    if (typeof s.signer !== 'string' || !s.signer.trim()) continue;
    if (typeof s.signedAt !== 'number' || !Number.isFinite(s.signedAt)) continue;
    if (typeof s.fingerprint !== 'string' || !s.fingerprint) continue;
    const rec: ArticleSignoff = {
      id: typeof s.id === 'string' && s.id ? s.id : uid('sign'),
      articleId: s.articleId,
      signer: s.signer.trim(),
      signedAt: s.signedAt,
      fingerprint: s.fingerprint,
      fpVersion: typeof s.fpVersion === 'string' && s.fpVersion ? s.fpVersion : 'v1',
    };
    const prev = latest.get(rec.articleId);
    if (!prev || rec.signedAt >= prev.signedAt) latest.set(rec.articleId, rec);
  }
  return [...latest.values()];
}
