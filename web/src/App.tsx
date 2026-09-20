import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, streamTurn } from './api';
import type { Conversation, ConvoMeta, Health, Message, Settings, StreamEvent } from './types';
import { Sidebar } from './components/Sidebar';
import { Composer } from './components/Composer';
import { MessageBubble } from './components/MessageBubble';
import { SettingsModal, ShortcutsModal } from './components/Modals';
import { Panel, Globe, Brain } from './components/Icons';

const SETTINGS_KEY = 'brb.settings.v1';

const DEFAULT_SETTINGS: Settings = { model: 'claude-opus-5', effort: 'high', webSearch: true, theme: 'dark' };

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const SUGGESTIONS = [
  'explain quantum entanglement',
  "what's good for dinner w/ chicken + rice",
  'write me a python script to rename files',
  'is it worth learning rust in 2026',
];

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [convos, setConvos] = useState<ConvoMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [convo, setConvo] = useState<Conversation | null>(null);
  const [query, setQuery] = useState('');
  const [input, setInput] = useState('');
  const [detail, setDetail] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 820);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 820);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= 820;
      setIsMobile((was) => {
        // Only force the sidebar when actually crossing the breakpoint,
        // so a manual toggle survives an ordinary window resize.
        if (was !== mobile) setSidebarOpen(!mobile);
        return mobile;
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* --------------------------- persistence --------------------------- */

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    api.health()
      .then((h) => { setHealth(h); setSettings((s) => ({ ...s, model: s.model || h.defaults.model })); })
      .catch(() => setToast('cant reach the server'));
  }, []);

  const recheckAuth = useCallback(async () => {
    setRechecking(true);
    try {
      const h = await api.health();
      setHealth(h);
      if (h.auth.ok) setAuthError(false);
    } catch { /* banner just stays up */ } finally {
      setRechecking(false);
    }
  }, []);

  const refreshList = useCallback(
    (q = query) => api.list(q).then(setConvos).catch(() => {}),
    [query],
  );

  useEffect(() => { refreshList(); }, [refreshList]);

  useEffect(() => {
    if (!activeId) { setConvo(null); return; }
    let cancelled = false;
    api.get(activeId).then((c) => { if (!cancelled) setConvo(c); }).catch(() => setActiveId(null));
    return () => { cancelled = true; };
  }, [activeId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  /* ---------------------------- scrolling ---------------------------- */

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

  /* ----------------------------- turns ------------------------------ */

  /** Applies streamed events to the trailing placeholder assistant message. */
  const handleEvent = useCallback((e: StreamEvent, convoId: string) => {
    if (e.type === 'tool') { setToolNote(e.detail?.slice(0, 60) ?? ''); return; }
    if (e.type === 'delta') {
      setToolNote(null);
      setConvo((c) => {
        // Guard on id: the user may have switched chats before this frame landed.
        if (!c || c.id !== convoId) return c;
        const msgs = c.messages.slice();
        const last = msgs[msgs.length - 1];
        if (last?.role !== 'assistant') return c;
        msgs[msgs.length - 1] = { ...last, content: last.content + e.text };
        return { ...c, messages: msgs };
      });
      return;
    }
    if (e.type === 'error') {
      if (e.kind === 'auth') setAuthError(true);
      setConvo((c) => {
        if (!c || c.id !== convoId) return c;
        const msgs = c.messages.slice();
        const last = msgs[msgs.length - 1];
        if (last?.role !== 'assistant') return c;
        msgs[msgs.length - 1] = { ...last, pending: false, error: { kind: e.kind, message: e.message } };
        return { ...c, messages: msgs };
      });
    }
  }, []);

  const runTurn = useCallback(
    async (path: string, body: Record<string, unknown>, convoId: string, optimistic: Message[]) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      setToolNote(null);
      stickRef.current = true;

      setConvo((c) => (c && c.id === convoId ? { ...c, messages: [...c.messages, ...optimistic] } : c));

      try {
        await streamTurn(path, { ...body, ...settings }, ac.signal, (e) => handleEvent(e, convoId));
      } catch (err) {
        if (!ac.signal.aborted) {
          handleEvent({ type: 'error', kind: 'network', message: 'lost connection to the server' }, convoId);
        }
      } finally {
        setStreaming(false);
        setToolNote(null);
        abortRef.current = null;
        // Re-read the canonical record so ids, metadata and the auto-title land.
        try {
          const fresh = await api.get(convoId);
          setConvo((c) => (c && c.id === convoId ? fresh : c));
        } catch { /* conversation was deleted mid-stream */ }
        refreshList();
      }
    },
    [settings, handleEvent, refreshList],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    let id = activeId;
    if (!id) {
      const created = await api.create();
      id = created.id;
      setConvo(created);
      setActiveId(id);
      setConvos((cs) => [{ ...created, messageCount: 0, preview: '' }, ...cs]);
    }

    setInput('');
    const wasDetail = detail;
    setDetail(false);
    setAuthError(false);

    const now = Date.now();
    await runTurn(
      `/api/conversations/${id}/messages`,
      { content: text, detail: wasDetail },
      id,
      [
        { id: `t-u-${now}`, role: 'user', content: text, createdAt: now, detail: wasDetail || undefined },
        { id: `t-a-${now}`, role: 'assistant', content: '', createdAt: now, pending: true },
      ],
    );
  }, [input, streaming, activeId, detail, runTurn]);

  const regenerate = useCallback(async () => {
    if (!convo || streaming) return;
    const msgs = convo.messages.slice();
    if (msgs[msgs.length - 1]?.role === 'assistant') msgs.pop();
    setConvo({ ...convo, messages: msgs });
    setAuthError(false);
    await runTurn(`/api/conversations/${convo.id}/regenerate`, {}, convo.id, [
      { id: `t-a-${Date.now()}`, role: 'assistant', content: '', createdAt: Date.now(), pending: true },
    ]);
  }, [convo, streaming, runTurn]);

  const editMessage = useCallback(
    async (messageId: string, content: string) => {
      if (!convo || streaming) return;
      const idx = convo.messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;
      setConvo({ ...convo, messages: convo.messages.slice(0, idx) });
      setAuthError(false);
      const now = Date.now();
      await runTurn(`/api/conversations/${convo.id}/edit`, { messageId, content }, convo.id, [
        { id: `t-u-${now}`, role: 'user', content, createdAt: now },
        { id: `t-a-${now}`, role: 'assistant', content: '', createdAt: now, pending: true },
      ]);
    },
    [convo, streaming, runTurn],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  /* ------------------------- conversation ops ------------------------- */

  const newChat = useCallback(() => {
    stop();
    setActiveId(null);
    setConvo(null);
    setInput('');
    setDetail(false);
    if (isMobile) setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 60);
  }, [stop, isMobile]);

  const selectChat = useCallback((id: string) => {
    stop();
    setActiveId(id);
    if (isMobile) setSidebarOpen(false);
  }, [stop, isMobile]);

  const renameChat = (id: string, title: string) => {
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, title } : c)));
    api.patch(id, { title, autoTitled: true }).then(() => refreshList());
  };

  const pinChat = (id: string, pinned: boolean) => {
    setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, pinned } : c)));
    api.patch(id, { pinned }).then(() => refreshList());
  };

  const deleteChat = async (id: string) => {
    await api.remove(id);
    if (id === activeId) { setActiveId(null); setConvo(null); }
    refreshList();
    setToast('chat deleted');
  };

  /* ---------------------------- shortcuts ---------------------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? '');

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); newChat(); return; }
      if (mod && e.key === '/') { e.preventDefault(); setSidebarOpen(true); searchRef.current?.focus(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setDetail((d) => !d); return; }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); setSidebarOpen((s) => !s); return; }
      if (e.key === 'Escape') {
        if (showSettings) return setShowSettings(false);
        if (showShortcuts) return setShowShortcuts(false);
        if (streaming) { e.preventDefault(); stop(); }
        return;
      }
      if (e.key === '?' && !typing) { e.preventDefault(); setShowShortcuts(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat, stop, streaming, showSettings, showShortcuts]);

  /* ------------------------------ render ------------------------------ */

  const messages = convo?.messages ?? [];
  const lastAssistantId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'assistant')?.id ?? null,
    [messages],
  );

  const modelLabel = health?.models.find((m) => m.id === settings.model)?.label ?? 'opus 5';
  const needsSetup = authError || health?.auth.ok === false;

  return (
    <div className="app">
      <Sidebar
        convos={convos}
        activeId={activeId}
        query={query}
        settings={settings}
        searchRef={searchRef}
        onQuery={(q) => { setQuery(q); api.list(q).then(setConvos).catch(() => {}); }}
        onSelect={selectChat}
        onNew={newChat}
        onRename={renameChat}
        onPin={pinChat}
        onDelete={deleteChat}
        onOpenSettings={() => setShowSettings(true)}
        onOpenShortcuts={() => setShowShortcuts(true)}
        open={sidebarOpen}
        onToggleTheme={() => setSettings((s) => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
      />
      {sidebarOpen && isMobile && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <div className="main">
        <div className="topbar">
          <button className="icon-btn" onClick={() => setSidebarOpen((s) => !s)} title="Toggle sidebar (⌘B)">
            <Panel size={17} />
          </button>
          <div className="topbar-title">{convo?.title ?? 'new chat'}</div>
          <div className="topbar-right">
            {settings.webSearch && (
              <span className="pill" title="Web search is on">
                <Globe /><span className="label-hide">web</span>
              </span>
            )}
            <button className="pill" onClick={() => setShowSettings(true)} title="Model & effort">
              <Brain /> {modelLabel}<span className="label-hide"> · {settings.effort}</span>
            </button>
          </div>
        </div>

        <div className="scroll" ref={scrollRef} onScroll={onScroll}>
          {messages.length === 0 ? (
            <div className="empty">
              <div className="empty-mark">b</div>
              <h1>wassup</h1>
              <p>ask me anything. i keep it short unless u tell me not to.</p>
              <div className="chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" onClick={() => { setInput(s); inputRef.current?.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="thread">
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  streaming={streaming && i === messages.length - 1}
                  toolNote={streaming && i === messages.length - 1 ? toolNote : null}
                  isLastAssistant={m.id === lastAssistantId}
                  onRegenerate={regenerate}
                  onEdit={(content) => editMessage(m.id, content)}
                />
              ))}
            </div>
          )}
        </div>

        {needsSetup && (
          <div style={{ padding: '0 20px' }}>
            <div className="setup">
              <div className="t">one-time setup</div>
              <div className="b">brb runs on your own claude account — no api key needed. run this once, in a terminal:</div>
              <div className="setup-cmd"><code>npm run login</code></div>
              <button className="btn" onClick={recheckAuth} disabled={rechecking}>
                {rechecking ? 'checking…' : 'check again'}
              </button>
            </div>
          </div>
        )}

        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          onStop={stop}
          streaming={streaming}
          detail={detail}
          onToggleDetail={() => setDetail((d) => !d)}
          inputRef={inputRef}
        />
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          health={health}
          onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
