export function svgPlaceholderSprite(label: string, color = '#e0b46a') {
  const safe = label.replace(/[<>&]/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="640" viewBox="0 0 320 640">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#2b2224" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="320" height="640" fill="transparent"/>
  <ellipse cx="160" cy="120" rx="58" ry="64" fill="url(#g)"/>
  <path d="M70 250 C90 180 230 180 250 250 L240 560 C220 610 100 610 80 560 Z" fill="url(#g)"/>
  <text x="160" y="620" text-anchor="middle" fill="#f2ece4" font-size="22" font-family="serif">${safe}</text>
</svg>`
  return Buffer.from(svg, 'utf8')
}

export function svgPlaceholderBackground(name: string) {
  const safe = name.replace(/[<>&]/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#211b1d"/>
      <stop offset="55%" stop-color="#2b2224"/>
      <stop offset="100%" stop-color="#100d0e"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#sky)"/>
  <circle cx="980" cy="140" r="70" fill="#e0b46a" fill-opacity="0.35"/>
  <rect x="0" y="480" width="1280" height="240" fill="#171315"/>
  <text x="640" y="360" text-anchor="middle" fill="#aca49d" font-size="42" font-family="serif">${safe}</text>
</svg>`
  return Buffer.from(svg, 'utf8')
}
