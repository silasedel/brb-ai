import { useEffect, useRef } from 'react';
import { Send, Stop, Brain } from './Icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  detail: boolean;
  onToggleDetail: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function Composer({ value, onChange, onSend, onStop, streaming, detail, onToggleDetail, inputRef }: Props) {
  const wrap = useRef<HTMLDivElement>(null);

  // Grow with the content, then scroll. Clearing the inline height first (rather
  // than setting 'auto') hands the box back to the stylesheet before measuring,
  // so a measurement taken during an unsettled first layout can't get stuck.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const fit = () => {
      el.style.height = '';
      if (el.value) el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    };
    fit();
    // Re-fit once the first frame has settled, and on any viewport change.
    const raf = requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', fit); };
  }, [value, inputRef]);

  const keyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSend(); // mid-reply this interrupts, like cutting someone off
    }
  };

  return (
    <div className="composer-zone">
      <div className="composer" ref={wrap}>
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          placeholder={streaming ? 'cut it off…' : detail ? 'ask for the full breakdown…' : 'message brb…'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={keyDown}
        />
        <div className="composer-btns">
          <button
            className={`detail-toggle${detail ? ' on' : ''}`}
            onClick={onToggleDetail}
            title="Detail mode — ask for the long, thorough answer (⌘⇧D)"
          >
            <Brain />
            <span className="label-hide">detail</span>
          </button>
          {streaming && !value.trim() ? (
            <button className="send stop" onClick={onStop} aria-label="Stop generating"><Stop /></button>
          ) : (
            <button
              className="send"
              onClick={onSend}
              disabled={!value.trim()}
              title={streaming ? 'cut it off and send this' : 'send'}
              aria-label="Send message"
            >
              <Send />
            </button>
          )}
        </div>
      </div>
      <div className="composer-hint">
        <kbd>enter</kbd> send<span style={{ opacity: 0.4 }}>·</span>
        <kbd>shift</kbd>+<kbd>enter</kbd> newline<span style={{ opacity: 0.4 }}>·</span>
        <kbd>esc</kbd> stop
      </div>
    </div>
  );
}
