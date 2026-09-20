import { useEffect, useRef, useState } from 'react';
import { backend } from '../backend';
import type { MemoryItem } from '../types';
import { Plus, Trash, Check, X } from './Icons';

/**
 * Everything the assistant has learned about you, in one place, editable.
 * Memory people can't see or correct is a bug, not a feature.
 */
export function MemoryPanel({ onClose, onChanged }: { onClose: () => void; onChanged: (n: number) => void }) {
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const load = () =>
    backend.listMemory().then((v) => { setItems(v); onChanged(v.length); });

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const add = async () => {
    const t = draft.trim();
    if (!t) return;
    setDraft('');
    await backend.addMemory(t);
    load();
    addRef.current?.focus();
  };

  const saveEdit = async (id: string) => {
    const t = editText.trim();
    setEditing(null);
    if (t) { await backend.updateMemory(id, t); load(); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>what it knows about you</h2>
            <p className="sub">carried into every new chat. edit or delete anything.</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="mem-add">
          <input
            ref={addRef}
            placeholder="teach it something — “they prefer typescript”"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button className="btn primary" onClick={add} disabled={!draft.trim()}>
            <Plus size={14} /> add
          </button>
        </div>

        <div className="mem-list">
          {items === null && <div className="mem-empty">loading…</div>}

          {items?.length === 0 && (
            <div className="mem-empty">
              <strong>nothing yet</strong>
              <span>just talk to it. it picks things up on its own — your name, what you're building, what you can't eat.</span>
            </div>
          )}

          {items?.map((it) => (
            <div className="mem-item" key={it.id}>
              {editing === it.id ? (
                <>
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(it.id);
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <button className="icon-btn" onClick={() => saveEdit(it.id)} aria-label="Save"><Check size={14} /></button>
                </>
              ) : (
                <>
                  <span className={`mem-dot ${it.source}`} title={it.source === 'auto' ? 'learned from a conversation' : 'you added this'} />
                  <span
                    className="mem-text"
                    onClick={() => { setEditing(it.id); setEditText(it.text); }}
                    title="click to edit"
                  >
                    {it.text}
                  </span>
                  <button
                    className="icon-btn danger"
                    onClick={async () => { await backend.removeMemory(it.id); load(); }}
                    aria-label="Forget this"
                  >
                    <Trash size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="modal-foot">
          {!!items?.length && (
            confirmClear ? (
              <>
                <button className="btn" onClick={() => setConfirmClear(false)}>cancel</button>
                <button
                  className="btn danger"
                  onClick={async () => { await backend.clearMemory(); setConfirmClear(false); load(); }}
                >
                  forget everything
                </button>
              </>
            ) : (
              <button className="btn danger" onClick={() => setConfirmClear(true)}>forget everything</button>
            )
          )}
          <button className="btn primary" onClick={onClose}>done</button>
        </div>
      </div>
    </div>
  );
}
