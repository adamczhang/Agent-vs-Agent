import type { ReactNode } from 'react';

// Line icons drawn on a 24-unit grid, inheriting the text color. Decorative: every button carries its own label.
function Svg({ children, size = 18, filled = false }: { children: ReactNode; size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>;
}
export const Icon = {
  compose: () => <Svg><path d="M11 4H6.5A2.5 2.5 0 0 0 4 6.5v11A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V13" /><path d="M18.3 3.7a1.9 1.9 0 0 1 2.7 2.7L12.6 14.8 9 15.8l1-3.6z" /></Svg>,
  search: () => <Svg size={15}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>,
  pause: () => <Svg filled><rect x="6.5" y="5" width="3.6" height="14" rx="1" /><rect x="13.9" y="5" width="3.6" height="14" rx="1" /></Svg>,
  play: () => <Svg filled><path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4A.8.8 0 0 0 8 5.6z" /></Svg>,
  next: () => <Svg filled><path d="M5 6.1v11.8a.8.8 0 0 0 1.2.7l8.6-5.9a.8.8 0 0 0 0-1.4L6.2 5.4A.8.8 0 0 0 5 6.1z" /><rect x="16.5" y="5" width="2.6" height="14" rx="1" /></Svg>,
  stop: () => <Svg filled><rect x="6" y="6" width="12" height="12" rx="2.5" /></Svg>,
  chart: () => <Svg><path d="M4 20h16" /><path d="M7.5 16.5v-5" /><path d="M12 16.5V7" /><path d="M16.5 16.5v-3" /></Svg>,
  chat: () => <Svg><path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4.5 19.5l1.3-4.2A7.5 7.5 0 1 1 20 11.5z" /></Svg>,
  more: () => <Svg filled><circle cx="5.5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="18.5" cy="12" r="1.6" /></Svg>,
  sliders: () => <Svg><path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" /><circle cx="15" cy="7.5" r="2" /><circle cx="9" cy="16.5" r="2" /></Svg>,
  send: () => <Svg size={16}><path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5" /></Svg>,
  close: () => <Svg size={16}><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></Svg>,
  replay: () => <Svg><path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" /><path d="M4 4v4.5h4.5" /></Svg>,
  download: () => <Svg><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" /></Svg>,
  warning: () => <Svg><path d="M10.3 4.3 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 17h.01" /></Svg>,
  build: () => <Svg><path d="m14.5 6.5 3-3 3 3-3 3" /><path d="M17.5 3.5 9 12" /><path d="M10.5 10.5 4 17a2.1 2.1 0 0 0 3 3l6.5-6.5" /><path d="m13 12 3 3" /></Svg>,
  folder: () => <Svg size={15}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></Svg>,
  attach: () => <Svg><path d="m20 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></Svg>,
  file: () => <Svg size={15}><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" /><path d="M14 3.5V8h4.5" /></Svg>,
  globe: () => <Svg size={14}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z" /></Svg>,
  pencil: () => <Svg><path d="M16.5 4.5a2.1 2.1 0 0 1 3 3L8.5 18.5l-4 1 1-4z" /></Svg>,
  refresh: () => <Svg><path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6" /><path d="M18 3v4h-4M6 21v-4h4" /></Svg>,
  chevron: () => <Svg size={13}><path d="m7 10 5 5 5-5" /></Svg>,
  prompt: () => <Svg><path d="M5 6.5h14M5 12h14M5 17.5h8" /></Svg>,
  window: () => <Svg><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><path d="M3.5 9h17" /><path d="M6.5 7h.01M8.8 7h.01" /></Svg>,
  external: () => <Svg size={14}><path d="M14 4.5h5.5V10" /><path d="M19.5 4.5 11 13" /><path d="M18 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10" /></Svg>,
  trash: () => <Svg><path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2" /><path d="M6.5 7l.9 11.2a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.5 7" /></Svg>,
};
