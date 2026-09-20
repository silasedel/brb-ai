import type { Health, Settings } from '../types';

const EFFORT_HINT: Record<string, string> = {
  low: 'snappy', medium: 'balanced', high: 'default', xhigh: 'deeper', max: 'no limits',
};

export function SettingsModal({
  settings, health, onChange, onClose,
}: {
  settings: Settings;
  health: Health | null;
  onChange: (patch: Partial<Settings>) => void;
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
