/** Storefront theme presets (from docs/research/02-website-patterns.md §6). */
import type { ThemeTokens } from '../db/schema';

export const THEMES: Record<string, ThemeTokens & { label: string; mood: string; fontsHref: string }> = {
  carnival: {
    preset: 'carnival', label: 'Backyard Carnival', mood: 'Bright, safe, upbeat — classic family bounce houses',
    primary: '#2563EB', primaryInk: '#FFFFFF', accent: '#FF5A1F', accentInk: '#1B1F4A',
    ink: '#1B1F4A', paper: '#FFFBF2', muted: '#E8E2D3',
    fontDisplay: "'Fredoka', ui-rounded, system-ui, sans-serif", fontBody: "'Nunito', system-ui, sans-serif", radius: 'round',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Nunito:wght@400;600;700;800&display=swap',
  },
  splash: {
    preset: 'splash', label: 'Splash Pop', mood: 'High-energy, cool, summery — water slides & foam parties',
    primary: '#0B6E99', primaryInk: '#FFFFFF', accent: '#D61A55', accentInk: '#FFFFFF',
    ink: '#06283D', paper: '#F0FBFF', muted: '#CFE9F3',
    fontDisplay: "'Baloo 2', ui-rounded, system-ui, sans-serif", fontBody: "'DM Sans', system-ui, sans-serif", radius: 'pill',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=DM+Sans:wght@400;500;700&display=swap',
  },
  mono: {
    preset: 'mono', label: 'Modern Mono Party', mood: 'Editorial, premium — white bounce houses, weddings, corporate',
    primary: '#8A6A4C', primaryInk: '#FFFFFF', accent: '#1F1A17', accentInk: '#FFFFFF',
    ink: '#1F1A17', paper: '#FAF7F2', muted: '#E6DFD6',
    fontDisplay: "'Fraunces', Georgia, serif", fontBody: "'Inter', system-ui, sans-serif", radius: 'soft',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap',
  },
  arcade: {
    preset: 'arcade', label: 'Arcade Booking App', mood: 'Fast, transparent, app-like — instant-book first',
    primary: '#5B3CF5', primaryInk: '#FFFFFF', accent: '#C2F04A', accentInk: '#0B0B0B',
    ink: '#0B0B0B', paper: '#F3F3F1', muted: '#DEDEDA',
    fontDisplay: "'Inter Tight', system-ui, sans-serif", fontBody: "'Inter', system-ui, sans-serif", radius: 'soft',
    fontsHref: 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap',
  },
};

export const themeFor = (t: ThemeTokens) => ({ ...THEMES[t.preset] ?? THEMES.carnival, ...t });

const RADII = { soft: ['8px', '12px'], round: ['14px', '22px'], pill: ['999px', '26px'] } as const;

/** Validate a hex colour (themes are operator-editable). */
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
const FONT_OK = /^[\w\s'",.-]{1,120}$/;

export function themeCss(t: ThemeTokens): string {
  const th = themeFor(t);
  const safe = (c: string, d: string) => (isHex(c) ? c : d);
  const font = (f: string, d: string) => (FONT_OK.test(f) ? f : d);
  const [btn, card] = RADII[th.radius] ?? RADII.round;
  return `:root{--c-primary:${safe(th.primary, '#2563EB')};--c-primary-ink:${safe(th.primaryInk, '#FFFFFF')};--c-accent:${safe(th.accent, '#FF5A1F')};--c-accent-ink:${safe(th.accentInk, '#FFFFFF')};--c-ink:${safe(th.ink, '#1B1F4A')};--c-paper:${safe(th.paper, '#FFFBF2')};--c-muted:${safe(th.muted, '#E8E2D3')};--f-display:${font(th.fontDisplay, 'system-ui')};--f-body:${font(th.fontBody, 'system-ui')};--r-btn:${btn};--r-card:${card}}`;
}
