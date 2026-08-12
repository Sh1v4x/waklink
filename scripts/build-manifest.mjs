#!/usr/bin/env node
/**
 * Scanne le dossier `media/` et génère `manifest.json`.
 *
 * Convention attendue :
 *   media/<serie>/<tome>/<planche-001.webp> ...
 *   media/<serie>/<planche-001.webp> ...      (one-shot, sans sous-dossier)
 *
 * La première image (ordre naturel) de chaque tome devient la couverture.
 * Un fichier optionnel `info.json` dans un dossier série ou tome permet de
 * surcharger { "title": "...", "status": "...", "description": "..." }.
 */

import { readdir, readFile, stat, writeFile, open } from 'node:fs/promises';
import { join, relative, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEDIA_DIR = join(ROOT, 'media');
const OUT_FILE = join(ROOT, 'manifest.json');
const IMAGE_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif']);

/* ------------------------------------------------------------------ utils */

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const naturalSort = (a, b) => collator.compare(a, b);

/** "wakfu-la-grande-vague" -> "Wakfu La Grande Vague" */
function humanize(slug) {
  return slug
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (/^\d+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** URL relative sûre (les segments sont encodés, les `/` conservés). */
function toUrl(absPath) {
  return relative(ROOT, absPath)
    .split(sep)
    .map((s) => encodeURIComponent(s))
    .join('/');
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function listDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const dirs = [];
  const images = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) dirs.push(e.name);
    else if (IMAGE_EXT.has(extname(e.name).toLowerCase())) images.push(e.name);
  }
  dirs.sort(naturalSort);
  images.sort(naturalSort);
  return { dirs, images };
}

/* --------------------------------------------------- dimensions d'image */
/* Lecture des en-têtes uniquement : aucune dépendance externe. */

function webpSize(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
      height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
    };
  }
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function pngSize(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf) {
  if (buf.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function jpegSize(buf) {
  if (buf.readUInt16BE(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    const len = buf.readUInt16BE(off + 2);
    // SOF0..SOF15 hors marqueurs DHT/JPG/DAC
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: buf.readUInt16BE(off + 7), height: buf.readUInt16BE(off + 5) };
    }
    off += 2 + len;
  }
  return null;
}

async function imageSize(path) {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead);
    const ext = extname(path).toLowerCase();
    const readers = ext === '.png' ? [pngSize] : ext === '.gif' ? [gifSize] : ext === '.webp' ? [webpSize] : [jpegSize, webpSize, pngSize, gifSize];
    for (const reader of readers) {
      try {
        const size = reader(head);
        if (size?.width > 0 && size?.height > 0) return size;
      } catch {
        /* en-tête inattendu : on tente le lecteur suivant */
      }
    }
  } finally {
    await fh.close();
  }
  return null;
}

/* ------------------------------------------------------------------ build */

async function buildPages(dir, fileNames) {
  return Promise.all(
    fileNames.map(async (name, i) => {
      const abs = join(dir, name);
      // Le poids sert à annoncer la taille d'un export PDF avant de le lancer.
      const [size, file] = await Promise.all([imageSize(abs), stat(abs).catch(() => null)]);
      return {
        index: i + 1,
        name,
        src: toUrl(abs),
        width: size?.width ?? null,
        height: size?.height ?? null,
        bytes: file?.size ?? null,
      };
    })
  );
}

async function buildTome(dir, slug, seriesTitle, fileNames) {
  const info = (await readJsonIfExists(join(dir, 'info.json'))) ?? {};
  const pages = await buildPages(dir, fileNames);
  const label = info.label ?? humanize(slug);
  return {
    slug,
    label,
    title: info.title ?? `${seriesTitle} - ${label}`,
    description: info.description ?? null,
    status: info.status ?? (pages.length ? 'Disponible' : 'Prochainement'),
    pageCount: pages.length,
    bytes: pages.reduce((n, p) => n + (p.bytes ?? 0), 0),
    cover: pages[0] ?? null,
    pages,
  };
}

async function buildSeries(dir, slug) {
  const info = (await readJsonIfExists(join(dir, 'info.json'))) ?? {};
  const title = info.title ?? humanize(slug);
  const { dirs, images } = await listDir(dir);

  const tomes = [];
  for (const tomeSlug of dirs) {
    const tomeDir = join(dir, tomeSlug);
    const { images: tomeImages } = await listDir(tomeDir);
    tomes.push(await buildTome(tomeDir, tomeSlug, title, tomeImages));
  }
  // Images posées directement dans le dossier série -> tome unique.
  if (images.length) {
    const single = await buildTome(dir, slug, title, images);
    single.label = info.label ?? 'Intégrale';
    single.title = info.title ?? title;
    tomes.unshift(single);
  }

  return {
    slug,
    title,
    description: info.description ?? null,
    tomeCount: tomes.length,
    pageCount: tomes.reduce((n, t) => n + t.pageCount, 0),
    bytes: tomes.reduce((n, t) => n + t.bytes, 0),
    tomes,
  };
}

async function main() {
  try {
    const s = await stat(MEDIA_DIR);
    if (!s.isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`✗ Dossier introuvable : ${MEDIA_DIR}`);
    process.exit(1);
  }

  const { dirs } = await listDir(MEDIA_DIR);
  const series = [];
  for (const slug of dirs) series.push(await buildSeries(join(MEDIA_DIR, slug), slug));

  const manifest = {
    generatedAt: new Date().toISOString(),
    seriesCount: series.length,
    series,
  };

  await writeFile(OUT_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

  console.log(`✓ manifest.json — ${series.length} série(s)`);
  for (const s of series) {
    console.log(`  · ${s.title} (${s.tomeCount} tome(s), ${s.pageCount} planches)`);
    for (const t of s.tomes) {
      const cover = t.cover ? t.cover.name : '— aucune image, tome ignoré à l’affichage';
      console.log(`      ${t.label}: ${t.pageCount} planches · couverture ${cover}`);
    }
  }
  const missing = series.flatMap((s) => s.tomes.flatMap((t) => t.pages)).filter((p) => !p.width);
  if (missing.length) console.warn(`! ${missing.length} image(s) sans dimensions lisibles (ratio par défaut appliqué)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
