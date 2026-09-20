/** Inline 16px stroke icons. Keeps the bundle free of an icon dependency. */
type P = { size?: number };
const s = (n = 16) => ({
  width: n, height: n, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.9,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
});

export const Plus = ({ size }: P) => <svg {...s(size)}><path d="M12 5v14M5 12h14" /></svg>;
export const Search = ({ size = 14 }: P) => <svg {...s(size)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>;
export const Trash = ({ size }: P) => <svg {...s(size)}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>;
export const Pencil = ({ size }: P) => <svg {...s(size)}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
export const Pin = ({ size = 13 }: P) => <svg {...s(size)} fill="currentColor" stroke="none"><path d="M16 3v6l2.5 4H13v8h-2v-8H5.5L8 9V3h8Z" /></svg>;
export const Copy = ({ size }: P) => <svg {...s(size)}><rect x="9" y="9" width="12" height="12" rx="2.2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
export const Check = ({ size }: P) => <svg {...s(size)}><path d="m4 12.5 5 5L20 6.5" /></svg>;
export const Refresh = ({ size }: P) => <svg {...s(size)}><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>;
export const Send = ({ size = 17 }: P) => <svg {...s(size)}><path d="M12 19V5" /><path d="m5.5 11.5 6.5-6.5 6.5 6.5" /></svg>;
export const Stop = ({ size = 15 }: P) => <svg {...s(size)} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2.6" /></svg>;
export const Globe = ({ size = 13 }: P) => <svg {...s(size)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" /></svg>;
export const Sliders = ({ size }: P) => <svg {...s(size)}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></svg>;
export const Sun = ({ size }: P) => <svg {...s(size)}><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>;
export const Moon = ({ size }: P) => <svg {...s(size)}><path d="M21 13A9 9 0 1 1 11 3a7.2 7.2 0 0 0 10 10Z" /></svg>;
export const Panel = ({ size }: P) => <svg {...s(size)}><rect x="3" y="4" width="18" height="16" rx="2.4" /><path d="M9.5 4v16" /></svg>;
export const Brain = ({ size = 14 }: P) => <svg {...s(size)}><path d="M9.5 3a2.8 2.8 0 0 0-2.8 2.8A2.7 2.7 0 0 0 4.5 8.4a2.8 2.8 0 0 0 .8 2 2.8 2.8 0 0 0 .5 3.9A2.8 2.8 0 0 0 9 18.4a2.6 2.6 0 0 0 3.2.4V3.9A2.7 2.7 0 0 0 9.5 3Z" /><path d="M14.5 3a2.8 2.8 0 0 1 2.8 2.8 2.7 2.7 0 0 1 2.2 2.6 2.8 2.8 0 0 1-.8 2 2.8 2.8 0 0 1-.5 3.9 2.8 2.8 0 0 1-3.2 4.1" /></svg>;
export const Keyboard = ({ size }: P) => <svg {...s(size)}><rect x="2" y="6" width="20" height="12" rx="2.2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" /></svg>;
export const X = ({ size }: P) => <svg {...s(size)}><path d="M18 6 6 18M6 6l12 12" /></svg>;
export const Key = ({ size }: P) => <svg {...s(size)}><circle cx="7.5" cy="15.5" r="4" /><path d="m10.5 12.5 8-8M16 7l2.5 2.5M13.5 9.5 16 12" /></svg>;
