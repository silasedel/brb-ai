import { useState } from 'react';
import type { CheckInConfig, Health, Settings } from '../types';

const EFFORT_HINT: Record<string, string> = {
  low: 'snappy', medium: 'balanced', high: 'default', xhigh: 'deeper', max: 'no limits',
};

export function SettingsModal({
  settings, health, checkins, onChange, onCheckins, onClose,
}: {
  settings: Settings;
  health: Health | null;
  checkins: CheckInConfig | null;
  onChange: (patch: Partial<Settings>) => void;
  onCheckins: (patch: Partial<CheckInConfig>) => void;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>settings</h2>
        <p className="sub">applies to your next message</p>

        <div className="field">
          <label className="field-label">model</label>
          <div className="seg">
            {(health?.models ?? []).map((m) => (
              <button
                key={m.id}
                className={settings.model === m.id ? 'on' : ''}
                onClick={() => onChange({ model: m.id })}
              >
                {m.label}
                <small>{m.hint}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label">thinking effort</label>
          <div className="seg">
            {(health?.efforts ?? []).map((e) => (
              <button key={e} className={settings.effort === e ? 'on' : ''} onClick={() => onChange({ effort: e })}>
                {e}
                <small>{EFFORT_HINT[e]}</small>
              </button>
            ))}
          </div>
          <div className="field-note">
            higher effort means more internal reasoning before it answers. replies stay just as short —
            it just gets them right more often. costs more of your usage quota.
          </div>
        </div>

        <div className="field">
          <div className="switch-row" onClick={() => onChange({ webSearch: !settings.webSearch })} role="button" tabIndex={0}>
            <div>
              <div className="t">web search</div>
              <div className="d">let it look things up for current info</div>
            </div>
            <div className={`switch${settings.webSearch ? ' on' : ''}`} />
          </div>
        </div>

        <div className="field">
          <label className="field-label">texting you first</label>
          <div
            className="switch-row"
            onClick={() => onCheckins({ enabled: !(checkins?.enabled ?? true) })}
            role="button"
            tabIndex={0}
          >
            <div>
              <div className="t">let it start conversations</div>
              <div className="d">it looks for something genuinely relevant, or stays quiet</div>
            </div>
            <div className={`switch${checkins?.enabled ? ' on' : ''}`} />
          </div>
          {checkins?.enabled && (
            <>
              <div className="seg" style={{ marginTop: 8 }}>
                {[3, 6, 12, 24].map((h) => (
                  <button
                    key={h}
                    className={checkins.everyHours === h ? 'on' : ''}
                    onClick={() => onCheckins({ everyHours: h })}
                  >
                    {h < 24 ? `${h}h` : 'daily'}
                    <small>at most</small>
                  </button>
                ))}
              </div>
              <div className="field-note">
                a ceiling, not a schedule — it only sends when it actually has something,
                and never between 11pm and 8am.
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>done</button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['new chat', '⌘ K'],
  ['search chats', '⌘ /'],
  ['detail mode', '⌘ ⇧ D'],
  ['toggle sidebar', '⌘ B'],
  ['stop generating', 'esc'],
  ['send', 'enter'],
  ['newline', 'shift enter'],
  ['this dialog', '?'],
];

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
        <h2>shortcuts</h2>
        <p className="sub">the ones worth knowing</p>
        <div className="shortcut-list">
          {SHORTCUTS.map(([label, keys]) => (
            <div key={label}><span>{label}</span><kbd>{keys}</kbd></div>
          ))}
        </div>
        <div className="modal-foot"><button className="btn primary" onClick={onClose}>got it</button></div>
      </div>
    </div>
  );
}

export function KeyModal({
  initial, onSave, onClose,
}: {
  initial: string | null;
  onSave: (k: string | null) => void;
  onClose: () => void;
}) {
  const [val, setVal] = useState(initial ?? '');
  const ok = val.trim().startsWith('sk-ant-');

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>add ur api key</h2>
        <p className="sub">one time. then it just works.</p>

        <div className="field">
          <input
            className="key-input"
            type="password"
            autoFocus
            spellCheck={false}
            placeholder="sk-ant-..."
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok) { onSave(val.trim()); onClose(); } }}
          />
          <div className="field-note">
            grab one free at{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer noopener">
              console.anthropic.com
            </a>
            . new accounts get trial credit, so this costs nothing to try.
          </div>
        </div>

        <div className="key-privacy">
          <strong>where ur key goes:</strong> nowhere. this site is a static page with no
          backend — the key stays in this browser and is sent straight to anthropic from ur
          own machine. nobody else can see it, including whoever made this.
        </div>

        <div className="modal-foot">
          {initial && (
            <button className="btn danger" onClick={() => { onSave(null); onClose(); }}>remove</button>
          )}
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn primary" disabled={!ok} onClick={() => { onSave(val.trim()); onClose(); }}>
            save
          </button>
        </div>
      </div>
    </div>
  );
}
