// Library colour themes. The owner picks one (FIXED) or lets it follow the calendar (monthly / seasonal / yearly).
// Only a few colours change — they are applied as CSS variables, so every page picks them up without re-rendering.
export type Palette = { label: string; accent: string; side: string; sideHover: string; link: string; bg: string; soft: string };

export const THEMES: Record<string, Palette> = {
  classic:  { label: 'Classic navy',   accent: '#172033', side: '#111827', sideHover: '#243047', link: '#3657d6', bg: '#f5f7fb', soft: '#eef1f7' },
  ocean:    { label: 'Ocean blue',     accent: '#0b5c8a', side: '#0a3550', sideHover: '#134b6c', link: '#0b7bb8', bg: '#f1f7fb', soft: '#e3f0f8' },
  forest:   { label: 'Forest green',   accent: '#1f6b46', side: '#12392a', sideHover: '#1c5039', link: '#1f8a5a', bg: '#f2f8f4', soft: '#e1f1e8' },
  sunset:   { label: 'Sunset orange',  accent: '#c2410c', side: '#4a1d0c', sideHover: '#6b2c14', link: '#d9560f', bg: '#fdf6f1', soft: '#fbe9dd' },
  royal:    { label: 'Royal purple',   accent: '#5b2fb3', side: '#2a1657', sideHover: '#3d2380', link: '#6d3fd0', bg: '#f7f4fd', soft: '#ece4fa' },
  rose:     { label: 'Rose pink',      accent: '#be185d', side: '#4c0f2c', sideHover: '#701a42', link: '#d6286f', bg: '#fdf3f7', soft: '#fbe3ee' },
  midnight: { label: 'Midnight dark',  accent: '#6366f1', side: '#0b1020', sideHover: '#1b2340', link: '#818cf8', bg: '#e9ecf5', soft: '#dde1f0' },
  amber:    { label: 'Golden amber',   accent: '#92400e', side: '#3b2308', sideHover: '#59360f', link: '#b45309', bg: '#fdf8ee', soft: '#f7ecd2' },
};
export const THEME_NAMES = Object.keys(THEMES);
export const THEME_MODES = [
  ['FIXED', 'One theme all the time'],
  ['MONTHLY', 'Change every month'],
  ['SEASONAL', 'Change with the season'],
  ['YEARLY', 'Change every year'],
] as const;

// Order used by the automatic modes (Jan → Dec). A little variety, festive months get warm colours.
const MONTH_THEMES = ['ocean', 'rose', 'forest', 'amber', 'sunset', 'royal', 'ocean', 'forest', 'classic', 'sunset', 'amber', 'midnight'];
const SEASON_THEMES = { winter: 'ocean', spring: 'forest', summer: 'sunset', monsoon: 'royal', autumn: 'amber' } as const;

/** Indian-style seasons by month, because the app defaults to India (utcOffsetMin = 330). */
export function seasonOf(m: number): keyof typeof SEASON_THEMES {
  if (m === 11 || m === 0 || m === 1) return 'winter';
  if (m === 2 || m === 3) return 'spring';
  if (m === 4 || m === 5) return 'summer';
  if (m >= 6 && m <= 8) return 'monsoon';
  return 'autumn';
}

export function resolveTheme(mode: string, name: string, now = new Date()): string {
  if (mode === 'MONTHLY') return MONTH_THEMES[now.getMonth()];
  if (mode === 'SEASONAL') return SEASON_THEMES[seasonOf(now.getMonth())];
  if (mode === 'YEARLY') return THEME_NAMES[now.getFullYear() % THEME_NAMES.length];
  return THEMES[name] ? name : 'classic';
}

export function applyTheme(name: string) {
  const p = THEMES[name] || THEMES.classic, s = document.documentElement.style;
  s.setProperty('--accent', p.accent); s.setProperty('--side', p.side); s.setProperty('--side-hover', p.sideHover);
  s.setProperty('--link', p.link); s.setProperty('--bg', p.bg); s.setProperty('--soft', p.soft);
}
export const clearTheme = () => ['--accent', '--side', '--side-hover', '--link', '--bg', '--soft'].forEach(k => document.documentElement.style.removeProperty(k));
