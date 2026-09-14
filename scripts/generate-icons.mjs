// Build-time PWA icon generator.
//
// Single source of truth for the "Google Tasks Swipe" app icon. Emits the
// canonical SVG (public/icons/icon.svg) plus every PNG the web manifest and
// index.html reference. Run with `npm run icons`.
//
// Icon concept: a bold white check mark with motion "swipe" streaks trailing to
// its left, on a Google-blue rounded field — i.e. swiping a task away as done.
//
// No new dependencies: `sharp` is the only thing imported.

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'public', 'icons');
const ROOT_PUBLIC = join(__dirname, '..', 'public');

const BRAND = '#1a73e8'; // Google blue — matches manifest theme_color
const FG = '#ffffff';

// The core artwork, drawn in a 512x512 viewBox WITHOUT a background so it can be
// composed onto either a rounded field ("any" icons) or a full-bleed field
// (maskable / apple-touch). `scale` shrinks the artwork toward the center so
// maskable icons keep their content inside the ~80% safe zone.
function artwork(scale = 1) {
  const cx = 256;
  const cy = 256;
  const t = `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`;
  return `
  <g transform="${t}" fill="none" stroke="${FG}" stroke-linecap="round" stroke-linejoin="round">
    <!-- swipe motion streaks trailing to the left of the check -->
    <g stroke-width="22" opacity="0.6">
      <line x1="72" y1="200" x2="132" y2="200" />
      <line x1="52" y1="256" x2="132" y2="256" />
      <line x1="72" y1="312" x2="132" y2="312" />
    </g>
    <!-- the check mark -->
    <path d="M 168 262 L 234 330 L 372 172" stroke-width="46" />
  </g>`;
}

// "any" icon: rounded-square field, artwork at full size.
function roundedSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" rx="104" ry="104" fill="${BRAND}"/>
  ${artwork(1)}
</svg>`;
}

// full-bleed field (for maskable + apple-touch); artwork scaled to a safe zone.
function fullBleedSvg(size, scale) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <rect x="0" y="0" width="512" height="512" fill="${BRAND}"/>
  ${artwork(scale)}
</svg>`;
}

async function renderPng(svg, size, outPath) {
  const buf = await sharp(Buffer.from(svg))
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer();
  await writeFile(outPath, buf);
  const meta = await sharp(buf).metadata();
  console.log(`  ${outPath.replace(join(__dirname, '..') + '/', '')}  ${meta.width}x${meta.height}  ${buf.length} bytes`);
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });

  // Canonical SVG source (also serves as a scalable icon / mask-icon candidate).
  const canonicalSvg = roundedSvg(512);
  await writeFile(join(ICONS_DIR, 'icon.svg'), canonicalSvg + '\n');
  console.log('Wrote public/icons/icon.svg');

  console.log('Rasterizing PNGs:');
  // "any" icons — transparent corners are fine here.
  await renderPng(roundedSvg(192), 192, join(ICONS_DIR, 'icon-192.png'));
  await renderPng(roundedSvg(512), 512, join(ICONS_DIR, 'icon-512.png'));

  // Maskable — full-bleed background, artwork inside the ~80% safe zone.
  await renderPng(fullBleedSvg(512, 0.72), 512, join(ICONS_DIR, 'icon-maskable-512.png'));

  // Apple touch icon — 180x180, solid background, no transparency. `flatten`
  // guarantees fully opaque pixels even if any transparency slipped through.
  const appleSvg = fullBleedSvg(180, 0.82);
  const appleBuf = await sharp(Buffer.from(appleSvg))
    .flatten({ background: BRAND })
    .resize(180, 180, { fit: 'contain' })
    .png()
    .toBuffer();
  const appleOut = join(ROOT_PUBLIC, 'apple-touch-icon.png');
  await writeFile(appleOut, appleBuf);
  const appleMeta = await sharp(appleBuf).metadata();
  console.log(`  public/apple-touch-icon.png  ${appleMeta.width}x${appleMeta.height}  hasAlpha=${appleMeta.hasAlpha}  ${appleBuf.length} bytes`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
