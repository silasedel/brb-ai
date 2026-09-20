import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { Copy, Check, Refresh, Pencil, Globe, Brain, X } from './Icons';
import type { Message } from '../types';

interface Props {
  msg: Message;
  streaming: boolean;
  toolNote: string | null;
  isLastAssistant: boolean;
  onRegenerate: () => void;
  onEdit: (content: string) => void;
}

export function MessageBubble({ msg, streaming, toolNote, isLastAssistant, onRegenerate, onEdit }: Props) {
  const me = msg.role === 'user';
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.content);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !ta.current) return;
    ta.current.focus();
    ta.current.selectionStart = ta.current.value.length;
    ta.current.style.height = '';
    ta.current.style.height = `${ta.current.scrollHeight}px`;
  }, [editing]);

  const copy = () => {
    navigator.clipboard.writeText(msg.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  const submitEdit = () => {
    const v = draft.trim();
    if (v && v !== msg.content) onEdit(v);
    setEditing(false);
  };

  // Blocks need the full column width; a short line looks better hugged.
  const hasBlock = /```|^\s*\|.*\|/m.test(msg.content);
  const empty = !msg.content && !msg.error;

  if (editing) {
    return (
      <div className="row me">
        <div className="bubble-wrap wide">
          <div className="bubble" style={{ width: '100%', background: 'var(--surface-2)', color: 'var(--text)' }}>
            <textarea
              ref={ta}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                e.target.style.height = '';
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === 'Escape') { setEditing(false); setDraft(msg.content); }
              }}
              style={{
                width: '100%', background: 'none', border: 'none', outline: 'none',
                resize: 'none', font: 'inherit', lineHeight: 1.5,
              }}
            />
          </div>
          <div className="meta-line sticky">
            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={submitEdit}>save & resend</button>
            <button className="icon-btn" onClick={() => { setEditing(false); setDraft(msg.content); }} aria-label="Cancel">
              <X size={13} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`row ${me ? 'me' : 'them'}`}>
      <div className={`bubble-wrap${hasBlock && !me ? ' wide' : ''}`}>
        {!me && toolNote && (
          <div className="tool-chip">
            <span className="dot" />
            <Globe />
            searching
            {toolNote && <span className="q">{toolNote}</span>}
          </div>
        )}

        <div className={`bubble${hasBlock && !me ? ' has-block' : ''}${msg.error ? ' errored' : ''}`}>
          {empty && streaming && (
            <div className="typing"><i /><i /><i /></div>
          )}
          {msg.error ? (
            <div style={{ fontSize: 13.5 }}>{msg.error.message}</div>
          ) : (
            msg.content && (me ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span> : <Markdown text={msg.content} />)
          )}
          {msg.aborted && msg.content && <span style={{ color: 'var(--text-faint)', fontSize: 12 }}> · stopped</span>}
        </div>

        <div className={`meta-line${msg.error && isLastAssistant ? ' sticky' : ''}`}>
          {msg.detail && <span title="answered in detail mode"><Brain size={11} /></span>}
          {msg.usedSearch && <span title="used web search"><Globe size={11} /></span>}
          <div className="msg-actions">
            {me ? (
              <button className="icon-btn" onClick={() => { setDraft(msg.content); setEditing(true); }} aria-label="Edit message">
                <Pencil size={12} />
              </button>
            ) : (
              <>
                {msg.content && (
                  <button className="icon-btn" onClick={copy} aria-label="Copy message">
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                )}
                {isLastAssistant && !streaming && (
                  <button className="icon-btn" onClick={onRegenerate} aria-label="Regenerate reply">
                    <Refresh size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
