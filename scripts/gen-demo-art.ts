/** Generates original, license-free SVG illustrations for the demo catalog. */
import { mkdirSync, writeFileSync } from 'node:fs';

const out = 'public/demo';
mkdirSync(out, { recursive: true });

const sky = (a: string, b: string) => `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="800" height="600" fill="url(#sky)"/><ellipse cx="400" cy="560" rx="520" ry="90" fill="#7BC96F"/><circle cx="680" cy="90" r="46" fill="#FFD43B" opacity=".9"/>`;

function castle(c1: string, c2: string, c3: string) {
  return `<g><rect x="200" y="250" width="400" height="240" rx="26" fill="${c1}"/>
  <rect x="230" y="300" width="340" height="170" rx="18" fill="#ffffff" opacity=".85"/>
  <path d="M230 300 h340 v40 h-340z" fill="${c3}" opacity=".9"/>
  ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="${238 + i * 48}" y="340" width="10" height="130" rx="5" fill="${c2}" opacity=".55"/>`).join('')}
  ${[170, 570].map((x) => `<rect x="${x}" y="190" width="60" height="300" rx="28" fill="${c2}"/><circle cx="${x + 30}" cy="185" r="34" fill="${c3}"/>`).join('')}
  <path d="M300 250 q100 -110 200 0" fill="${c2}"/>
  <rect x="180" y="480" width="440" height="40" rx="18" fill="${c2}"/>
  <path d="M300 520 h200 l40 30 h-280z" fill="${c3}" opacity=".8"/></g>`;
}

function slide(c1: string, c2: string, c3: string, wet: boolean) {
  return `<g><path d="M150 520 L330 150 h110 L640 520z" fill="${c1}"/>
  <path d="M250 520 L360 190 h50 L520 520z" fill="${c2}"/>
  ${[0, 1, 2, 3].map((i) => `<path d="M${262 + i * 66} 520 L${368 + i * 12} 200" stroke="#fff" stroke-width="8" opacity=".5"/>`).join('')}
  <rect x="310" y="110" width="150" height="60" rx="26" fill="${c3}"/>
  <rect x="120" y="500" width="560" height="50" rx="24" fill="${wet ? '#3BB3E8' : c3}"/>
  ${wet ? '<path d="M180 520 q30 -25 60 0 t60 0 t60 0 t60 0 t60 0 t60 0 t60 0" stroke="#fff" stroke-width="6" fill="none" opacity=".8"/>' : ''}</g>`;
}

function combo(c1: string, c2: string, c3: string) {
  return castle(c1, c2, c3) + `<path d="M600 300 L720 520 h-60 L560 340z" fill="${c3}"/><path d="M610 320 L700 520" stroke="#fff" stroke-width="6" opacity=".6"/>`;
}

function obstacle(c1: string, c2: string, c3: string) {
  return `<g><rect x="60" y="330" width="680" height="170" rx="40" fill="${c1}"/>
  ${[0, 1, 2, 3, 4].map((i) => `<rect x="${110 + i * 120}" y="${250 - (i % 2) * 40}" width="40" height="${130 + (i % 2) * 40}" rx="20" fill="${i % 2 ? c2 : c3}"/>`).join('')}
  <path d="M600 330 L700 200 h40 v130z" fill="${c2}"/><rect x="60" y="480" width="680" height="40" rx="18" fill="${c3}"/></g>`;
}

function game(c1: string, c2: string, c3: string) {
  return `<g><rect x="230" y="200" width="340" height="300" rx="30" fill="${c1}"/>
  <circle cx="400" cy="330" r="90" fill="#fff"/><circle cx="400" cy="330" r="60" fill="${c2}"/><circle cx="400" cy="330" r="28" fill="${c3}"/>
  <rect x="200" y="480" width="400" height="40" rx="18" fill="${c2}"/></g>`;
}

function machine(c1: string, c2: string) {
  return `<g><rect x="300" y="300" width="200" height="200" rx="20" fill="${c1}"/><circle cx="400" cy="250" r="110" fill="${c2}" opacity=".85"/>
  <circle cx="370" cy="230" r="40" fill="#fff" opacity=".6"/><rect x="280" y="490" width="240" height="30" rx="12" fill="#444"/></g>`;
}

function tent() {
  return `<g><path d="M140 300 L400 140 L660 300z" fill="#fff" stroke="#D9D4C7" stroke-width="6"/><rect x="160" y="300" width="480" height="20" fill="#E8E2D3"/>
  ${[170, 400, 630].map((x) => `<rect x="${x - 6}" y="300" width="12" height="220" fill="#B8B2A5"/>`).join('')}
  ${[0, 1, 2].map((i) => `<rect x="${250 + i * 110}" y="420" width="80" height="16" rx="6" fill="#8A6A4C"/><rect x="${280 + i * 110}" y="436" width="8" height="60" fill="#8A6A4C"/>`).join('')}</g>`;
}

function generator() {
  return `<g><rect x="260" y="300" width="280" height="190" rx="22" fill="#2E3A59"/><rect x="290" y="330" width="120" height="80" rx="10" fill="#FFD43B"/>
  <circle cx="470" cy="370" r="40" fill="#4C5B80"/><rect x="240" y="480" width="320" height="30" rx="12" fill="#1B1F4A"/></g>`;
}

const label = (t: string) => `<rect x="24" y="24" rx="18" width="${t.length * 17 + 40}" height="52" fill="#fff" opacity=".9"/><text x="44" y="60" font-family="Arial, sans-serif" font-weight="700" font-size="28" fill="#1B1F4A">${t}</text>`;
const svg = (body: string, t?: string, a = '#BDE7FF', b2 = '#FFF7E6') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img">${sky(a, b2)}${body}${t ? label(t) : ''}</svg>`;

const art: Record<string, string> = {
  'hero.svg': svg(castle('#2563EB', '#FF5A1F', '#FFC928') + `<g transform="translate(470 120) scale(.55)">${slide('#22A559', '#FFC928', '#2563EB', true)}</g>`),
  'castle-rainbow.svg': svg(castle('#7C3AED', '#F43F5E', '#FACC15')),
  'castle-classic.svg': svg(castle('#2563EB', '#EF4444', '#FACC15')),
  'castle-pink.svg': svg(castle('#EC4899', '#A855F7', '#FDE68A')),
  'castle-white.svg': svg(castle('#F5F1EA', '#D9CBB8', '#C9A27E'), undefined, '#F2E9E1', '#FFFFFF'),
  'castle-sports.svg': svg(castle('#16A34A', '#1D4ED8', '#F97316')),
  'combo-jungle.svg': svg(combo('#15803D', '#F59E0B', '#84CC16')),
  'combo-princess.svg': svg(combo('#DB2777', '#8B5CF6', '#FBCFE8')),
  'combo-ocean.svg': svg(combo('#0284C7', '#06B6D4', '#FDE047')),
  'slide-tropical.svg': svg(slide('#0EA5E9', '#22C55E', '#F97316', true)),
  'slide-dual.svg': svg(slide('#2563EB', '#EF4444', '#FACC15', true)),
  'slide-dry.svg': svg(slide('#7C3AED', '#F59E0B', '#EC4899', false)),
  'obstacle-40.svg': svg(obstacle('#F97316', '#2563EB', '#FACC15')),
  'obstacle-ninja.svg': svg(obstacle('#111827', '#EF4444', '#9CA3AF')),
  'game-dart.svg': svg(game('#1D4ED8', '#EF4444', '#FACC15')),
  'game-soccer.svg': svg(game('#16A34A', '#111827', '#FFFFFF')),
  'cotton-candy.svg': svg(machine('#EC4899', '#FBCFE8')),
  'snow-cone.svg': svg(machine('#0EA5E9', '#BAE6FD')),
  'tent.svg': svg(tent()),
  'generator.svg': svg(generator()),
  'og.svg': svg(castle('#2563EB', '#FF5A1F', '#FFC928'), 'BounceOS'),
};

for (const [f, s] of Object.entries(art)) writeFileSync(`${out}/${f}`, s);
console.log(`✓ wrote ${Object.keys(art).length} illustrations to ${out}`);
