import { useEffect, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import { Copy, Check, Refresh, Pencil, Globe, Brain, Wave, Brush, X } from './Icons';
import { parseReply } from '../reply';
import type { Message } from '../types';

interface Props {
  msg: Message;
  streaming: boolean;
  toolNote: { name: string; detail: string } | null;
  isLastAssistant: boolean;
  /** Tapback this message received, taken from the reply that followed it. */
  reaction?: string | null;
  onRegenerate: () => void;
  onEdit: (content: string) => void;
}

export function MessageBubble({ msg, streaming, toolNote, isLastAssistant, reaction, onRegenerate, onEdit }: Props) {
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

  if (editing) {
    return (
      <div className="row me">
        <div className="bubble-wrap wide">
          <div className="bubble" style={{ width: '100%', background: 'var(--surface-2)', color: 'var(--ink)' }}>
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
              style={{ width: '100%', background: 'none', border: 'none', outline: 'none', resize: 'none', font: 'inherit', lineHeight: 1.5 }}
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

  /* -------------------------- user -------------------------- */
  if (me) {
    return (
      <div className="row me">
        <div className="bubble-wrap">
          <div className="bubble">
            <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
            {reaction && <span className="tapback" title="brb reacted">{reaction}</span>}
          </div>
          <div className="meta-line">
            {msg.detail && <span title="answered in detail mode"><Brain size={11} /></span>}
            <div className="msg-actions">
              <button className="icon-btn" onClick={() => { setDraft(msg.content); setEditing(true); }} aria-label="Edit message">
                <Pencil size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ----------------------- assistant ------------------------ */
  // One reply becomes several texts, the way a person actually sends them.
  const { bubbles, holding } = parseReply(msg.content);
  const showTyping = streaming && (holding || bubbles.length === 0);

  return (
    <div className={`row them${msg.error ? ' has-error' : ''}`}>
      <div className="bubble-wrap wide-auto">
        {msg.checkin && <div className="checkin-tag"><Wave size={12} /> brb texted you first</div>}

        {toolNote && streaming && (() => {
          const drawing = toolNote.name.includes('draw');
          return (
            <div className="tool-chip">
              <span className="dot" />
              {drawing ? <Brush size={12} /> : <Globe />}
              {drawing ? 'drawing' : 'searching'}
              {toolNote.detail && <span className="q">{toolNote.detail}</span>}
            </div>
          );
        })()}

        {msg.error ? (
          <div className="bubble errored" style={{ fontSize: 13.5 }}>{msg.error.message}</div>
        ) : showTyping ? (
          <div className="bubble"><div className="typing"><i /><i /><i /></div></div>
        ) : (
          bubbles.map((b, i) => (
            <div
              key={i}
              className={`bubble${/```|^\s*\|/m.test(b) ? ' has-block' : ''}`}
              style={{ animationDelay: `${Math.min(i, 4) * 75}ms` }}
            >
              <Markdown text={b} />
            </div>
          ))
        )}

        {msg.aborted && bubbles.length > 0 && <div className="cut-off">stopped</div>}

        <div className={`meta-line${msg.error && isLastAssistant ? ' sticky' : ''}`}>
          {msg.detail && <span title="answered in detail mode"><Brain size={11} /></span>}
          {msg.usedSearch && <span title="used web search"><Globe size={11} /></span>}
          <div className="msg-actions">
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
          </div>
        </div>
      </div>
    </div>
  );
}
