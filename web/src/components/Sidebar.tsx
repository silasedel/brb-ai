import { useEffect, useRef, useState } from 'react';
import { Plus, Search, Trash, Pencil, Pin, Sliders, Sun, Moon, Keyboard } from './Icons';
import type { ConvoMeta, Settings } from '../types';

interface Props {
  open: boolean;
  convos: ConvoMeta[];
  activeId: string | null;
  query: string;
  settings: Settings;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onToggleTheme: () => void;
}

const DAY = 86_400_000;

/** Buckets conversations the way every chat app does: pinned, then recency. */
function group(convos: ConvoMeta[]) {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: Record<string, ConvoMeta[]> = {};
  const order: string[] = [];

  for (const c of convos) {
    let key: string;
    if (c.pinned) key = 'pinned';
    else if (c.updatedAt >= midnight) key = 'today';
    else if (c.updatedAt >= midnight - DAY) key = 'yesterday';
    else if (c.updatedAt >= midnight - 7 * DAY) key = 'previous 7 days';
    else if (c.updatedAt >= midnight - 30 * DAY) key = 'previous 30 days';
    else key = 'older';
    if (!buckets[key]) { buckets[key] = []; order.push(key); }
    buckets[key].push(c);
  }
  return order.map((k) => [k, buckets[k]] as const);
}

export function Sidebar(p: Props) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (renaming) renameRef.current?.select(); }, [renaming]);
  useEffect(() => { setConfirming(null); }, [p.convos.length]);

  const commit = (id: string) => {
    const v = draft.trim();
    if (v) p.onRename(id, v);
    setRenaming(null);
  };

  const groups = group(p.convos);

  return (
    <aside className={`sidebar${p.open ? '' : ' collapsed'}`}>
      <div className="sidebar-head">
        <div className="brand">
          <span className="brand-mark">b</span>
          brb
          <span className="brand-sub">claude, but chill</span>
        </div>
        <button className="new-chat" onClick={p.onNew}><Plus size={15} /> new chat</button>
        <div className="search-wrap">
          <Search />
          <input
            ref={p.searchRef}
            className="search"
            placeholder="search chats"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { p.onQuery(''); e.currentTarget.blur(); } }}
          />
        </div>
      </div>

      <div className="convo-list">
        {p.convos.length === 0 && (
          <div className="empty-list">{p.query ? 'nothing matches' : 'no chats yet'}</div>
        )}
        {groups.map(([label, items]) => (
          <div key={label}>
            <div className="convo-group-label">{label}</div>
            {items.map((c) => (
              <div
                key={c.id}
                className={`convo${c.id === p.activeId ? ' active' : ''}${confirming === c.id ? ' menu-open' : ''}`}
                onClick={() => renaming !== c.id && p.onSelect(c.id)}
                title={c.title}
              >
                {c.pinned && <span className="pin-dot"><Pin /></span>}
                <div className={`convo-title${renaming === c.id ? ' renaming' : ''}`}>
                  {renaming === c.id ? (
                    <input
                      ref={renameRef}
                      className="convo-rename"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => commit(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commit(c.id);
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : c.title}
                </div>

                {renaming !== c.id && (
                  <div className="convo-actions" onClick={(e) => e.stopPropagation()}>
                    {confirming === c.id ? (
                      <>
                        <button className="icon-btn danger" onClick={() => p.onDelete(c.id)} title="Confirm delete">
                          <Trash size={13} />
                        </button>
                        <button className="icon-btn" onClick={() => setConfirming(null)} title="Cancel">✕</button>
                      </>
                    ) : (
                      <>
                        <button className="icon-btn" title={c.pinned ? 'Unpin' : 'Pin'} onClick={() => p.onPin(c.id, !c.pinned)}>
                          <Pin size={12} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Rename"
                          onClick={() => { setDraft(c.title); setRenaming(c.id); }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button className="icon-btn danger" title="Delete" onClick={() => setConfirming(c.id)}>
                          <Trash size={12} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <button className="foot-btn" onClick={p.onOpenSettings}>
          <Sliders size={15} /> settings
          <span className="spacer">{p.settings.model.replace('claude-', '').replace(/-/g, ' ')}</span>
        </button>
        <button className="foot-btn" onClick={p.onToggleTheme}>
          {p.settings.theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
          {p.settings.theme === 'dark' ? 'dark' : 'light'} mode
        </button>
        <button className="foot-btn" onClick={p.onOpenShortcuts}>
          <Keyboard size={15} /> shortcuts <span className="spacer">?</span>
        </button>
      </div>
    </aside>
  );
}
