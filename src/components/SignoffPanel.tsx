import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/context';
import type { ArticleSignoff, ClauseNode } from '../../shared/model';
import { shortArticleLabel } from '../lib/labels';
import { signoffStatusMap, type SignoffStatus } from '../lib/signoff';

type Filter = 'all' | 'unsigned' | 'valid' | 'stale';

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const STATUS_TEXT: Record<SignoffStatus, string> = {
  unsigned: '未签',
  valid: '有效',
  stale: '待重签',
};

export function SignoffPanel() {
  const { store, highlighter } = useApp();
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), [store]);
  const { doc, analysis, signoffs } = store.getSnapshot();

  const [articleId, setArticleId] = useState('');
  const [signer, setSigner] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const builderRef = useRef<HTMLDivElement>(null);

  /** 当前文档下条 ID -> 审签状态（已删除条不参与）；指纹按当前条文实时重算 */
  const statusMap = useMemo(
    () => signoffStatusMap(doc.root, signoffs),
    [doc, signoffs],
  );
  const recordOf = useMemo(
    () => new Map(signoffs.map((s) => [s.articleId, s])),
    [signoffs],
  );

  const articles = doc.root;
  const counts = useMemo(() => {
    let valid = 0;
    let stale = 0;
    for (const a of articles) {
      const st = statusMap.get(a.id) ?? 'unsigned';
      if (st === 'valid') valid++;
      else if (st === 'stale') stale++;
    }
    return { total: articles.length, valid, stale, unsigned: articles.length - valid - stale };
  }, [articles, statusMap]);

  const selectedArticle: ClauseNode | null =
    articleId && analysis.nodes[articleId]?.kind === 'article'
      ? (analysis.nodes[articleId] as ClauseNode)
      : null;
  const selectedStatus = selectedArticle ? (statusMap.get(selectedArticle.id) ?? 'unsigned') : null;
  const selectedRecord = selectedArticle ? recordOf.get(selectedArticle.id) : undefined;

  // 选条变化或该条记录变化时：沿用该条上次审签人，便于重新签署
  useEffect(() => {
    if (selectedRecord) setSigner(selectedRecord.signer);
  }, [articleId, selectedRecord]);

  const submit = () => {
    if (!selectedArticle) {
      setError('请先选择要审签的条');
      return;
    }
    if (!signer.trim()) {
      setError('请填写审签人');
      return;
    }
    setError(null);
    store.signArticle(selectedArticle.id, signer);
  };

  const jump = (id: string) => highlighter.jumpTo(id);

  // 从某行发起签署：选入该条并把签署区滚动到可视范围
  const rowSign = (a: ClauseNode) => {
    setArticleId(a.id);
    const prev = recordOf.get(a.id);
    if (prev) setSigner(prev.signer);
    builderRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const visible = articles.filter((a) => {
    if (filter === 'all') return true;
    return (statusMap.get(a.id) ?? 'unsigned') === filter;
  });

  return (
    <div className="signoff-panel">
      <div className="signoff-builder" ref={builderRef}>
        <div className="signoff-builder-head">
          <span className="impact-title">条款审签</span>
          <span className="signoff-builder-note">对选定条录入审签人并按当前条文签署</span>
        </div>
        <div className="signoff-form">
          <select
            className="impact-select"
            value={selectedArticle ? articleId : ''}
            onChange={(e) => {
              setArticleId(e.target.value);
              setError(null);
            }}
            aria-label="选择要审签的条"
          >
            <option value="">选择条款…</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {shortArticleLabel(a.ordinal, a.suffix)}
                {a.title ? ` ${a.title}` : ''}
                {statusMap.get(a.id) === 'stale' ? '（待重签）' : ''}
              </option>
            ))}
          </select>
          <input
            className="signoff-name-input"
            type="text"
            value={signer}
            maxLength={40}
            placeholder="审签人姓名"
            aria-label="审签人"
            onChange={(e) => {
              setSigner(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
          />
          <button
            className="small primary"
            disabled={!selectedArticle || !signer.trim()}
            onClick={submit}
            title={selectedStatus === 'stale' ? '按当前条文重新签署' : '按当前条文签署'}
          >
            {selectedStatus === 'stale' ? '重新签署' : '签署'}
          </button>
        </div>
        {selectedArticle && selectedStatus && (
          <div className={`signoff-selected-hint is-${selectedStatus}`}>
            {shortArticleLabel(selectedArticle.ordinal, selectedArticle.suffix)}
            {selectedArticle.title ? `【${selectedArticle.title}】` : ''}
            {selectedStatus === 'unsigned'
              ? '：尚未签署。'
              : selectedStatus === 'valid'
                ? `：当前签署有效（${selectedRecord?.signer} · ${formatTime(selectedRecord!.signedAt)}），重新签署将覆盖原记录。`
                : '：条文自签署后已变化，请核对后重新签署。'}
          </div>
        )}
        {error && <div className="sandbox-error">{error}</div>}
      </div>

      <div className="issue-filters signoff-filters">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          全部 {counts.total}
        </button>
        <button
          className={`signoff-filter-unsigned ${filter === 'unsigned' ? 'active' : ''}`}
          disabled={counts.unsigned === 0}
          onClick={() => setFilter('unsigned')}
        >
          未签 {counts.unsigned}
        </button>
        <button
          className={`signoff-filter-valid ${filter === 'valid' ? 'active' : ''}`}
          disabled={counts.valid === 0}
          onClick={() => setFilter('valid')}
        >
          ✓ 有效 {counts.valid}
        </button>
        <button
          className={`signoff-filter-stale ${filter === 'stale' ? 'active' : ''}`}
          disabled={counts.stale === 0}
          onClick={() => setFilter('stale')}
        >
          ⚠ 待重签 {counts.stale}
        </button>
      </div>

      <div className="issue-list signoff-list">
        {visible.length === 0 && (
          <div className="empty-hint">
            {counts.total === 0
              ? '当前文档没有条款。'
              : '该状态下暂无条款。'}
          </div>
        )}
        {visible.map((a) => {
          const st = statusMap.get(a.id) ?? 'unsigned';
          const rec = recordOf.get(a.id);
          return (
            <SignoffRow
              key={a.id}
              article={a}
              status={st}
              record={rec}
              selected={a.id === articleId}
              onJump={() => jump(a.id)}
              onSign={() => rowSign(a)}
              onDelete={() => {
                if (rec && confirm('确定删除该条的审签记录？此操作可通过撤销恢复。')) {
                  store.deleteSignoff(a.id);
                }
              }}
            />
          );
        })}
      </div>

      <div className="panel-footer">
        指纹覆盖条号、条序号后缀、标题、条头正文及全部款、项内容；正文编辑、结构调整与引用自动改写后按当前条文重算，不一致即待重签，撤销恢复原文则恢复有效。已删除条不计入统计。
      </div>
    </div>
  );
}

function SignoffRow({
  article,
  status,
  record,
  selected,
  onJump,
  onSign,
  onDelete,
}: {
  article: ClauseNode;
  status: SignoffStatus;
  record?: ArticleSignoff;
  selected: boolean;
  onJump: () => void;
  onSign: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`issue-row signoff-row is-${status} ${selected ? 'signoff-row-active' : ''}`}>
      <div className="issue-row-head">
        <button className="signoff-jump" onClick={onJump} title="跳转到该条">
          <span className={`signoff-status-tag is-${status}`}>{STATUS_TEXT[status]}</span>
          <span className="signoff-article-label">
            {shortArticleLabel(article.ordinal, article.suffix)}
          </span>
          {article.title && <span className="signoff-article-title">【{article.title}】</span>}
        </button>
      </div>

      {record ? (
        <div className="signoff-meta">
          <span className="signoff-signer">审签人：{record.signer}</span>
          <span className="signoff-time">{formatTime(record.signedAt)}</span>
          <span className="signoff-fp" title={`签署时条文内容指纹（${record.fingerprint}）`}>
            指纹 {record.fingerprint.slice(0, 13)}…
          </span>
        </div>
      ) : (
        <div className="signoff-meta signoff-meta-empty">尚未录入审签人。</div>
      )}

      {status === 'stale' && (
        <div className="signoff-stale-line">
          条文自签署后已变化（正文、标题、条号或款 / 项结构），请核对后重新签署。
        </div>
      )}

      <div className="signoff-row-actions">
        <button className="link-btn" onClick={onSign}>
          {status === 'unsigned' ? '签署' : '重新签署'}
        </button>
        <button className="link-btn subtle" onClick={onJump}>
          跳转该条
        </button>
        {record && (
          <button className="link-btn subtle" onClick={onDelete}>
            删除记录
          </button>
        )}
      </div>
    </div>
  );
}
