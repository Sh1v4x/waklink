/* ===================================================================
   Waklink — assemblage PDF côté navigateur
   Les planches sont téléchargées, redécodées (webp → JPEG via canvas)
   puis empilées dans un PDF écrit à la main : aucune dépendance, rien
   ne transite par un serveur.

   Les JPEG restent des Blob jusqu'au bout — le navigateur les garde
   hors du tas JS, ce qui permet d'assembler 200 planches sans saturer
   la mémoire d'un téléphone.
   =================================================================== */

(() => {
  'use strict';

  const PAGE_WIDTH = 595.28; // largeur A4 en points : une planche = une page
  const encoder = new TextEncoder();

  /* -------------------------------------------------------- écriture */

  /** Collecteur d'octets : mémorise l'offset courant pour la table xref. */
  function createWriter() {
    const parts = [];
    let offset = 0;
    return {
      parts,
      get offset() {
        return offset;
      },
      push(part) {
        const chunk = typeof part === 'string' ? encoder.encode(part) : part;
        parts.push(chunk);
        offset += chunk.byteLength ?? chunk.size;
      },
    };
  }

  function writeObject(writer, offsets, num, dict, stream) {
    offsets[num] = writer.offset;
    writer.push(`${num} 0 obj\n${dict}\n`);
    if (stream) {
      writer.push('stream\n');
      writer.push(stream);
      writer.push('\nendstream\n');
    }
    writer.push('endobj\n');
  }

  const round2 = (n) => Math.round(n * 100) / 100;
  const pad10 = (n) => String(n).padStart(10, '0');

  /** Chaîne PDF en UTF-16BE : les accents des titres passent sans dommage. */
  function textString(value) {
    let hex = 'FEFF';
    for (const char of String(value)) {
      const code = char.codePointAt(0);
      if (code > 0xffff) {
        const rest = code - 0x10000;
        hex += (0xd800 + (rest >> 10)).toString(16).padStart(4, '0');
        hex += (0xdc00 + (rest & 0x3ff)).toString(16).padStart(4, '0');
      } else {
        hex += code.toString(16).padStart(4, '0');
      }
    }
    return `<${hex.toUpperCase()}>`;
  }

  function pdfDate(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `D:${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
      `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  }

  /* ------------------------------------------------------- rasterisation */

  let scratch = null;

  function scratchCanvas(width, height) {
    if (!scratch) {
      scratch = typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    }
    scratch.width = width;
    scratch.height = height;
    return scratch;
  }

  async function decodeImage(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    // Repli pour les navigateurs sans createImageBitmap.
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }

  async function encodeJpeg(source, width, height, quality) {
    const canvas = scratchCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    // Le JPEG ignore la transparence : un fond blanc évite les zones noires.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);

    if (typeof canvas.convertToBlob === 'function') {
      return canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Encodage JPEG impossible.'))),
        'image/jpeg',
        quality
      );
    });
  }

  async function rasterize(page, { quality, maxWidth, signal }) {
    const res = await fetch(page.src, { signal, cache: 'force-cache' });
    if (!res.ok) throw new Error(`Planche ${page.index} indisponible (HTTP ${res.status}).`);

    const source = await decodeImage(await res.blob());
    const naturalWidth = source.width ?? source.naturalWidth;
    const naturalHeight = source.height ?? source.naturalHeight;
    const scale = Math.min(1, maxWidth / naturalWidth);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const jpeg = await encodeJpeg(source, width, height, quality);
    source.close?.();
    return { jpeg, width, height };
  }

  /* ------------------------------------------------------------- build */

  function abortError() {
    const err = new Error('Assemblage interrompu.');
    err.name = 'AbortError';
    return err;
  }

  /**
   * Assemble les planches en un PDF (une planche par page).
   * @param {Array<{index:number, src:string}>} pages
   * @param {{title?:string, quality?:number, maxWidth?:number,
   *          signal?:AbortSignal, onProgress?:(done:number,total:number,bytes:number)=>void}} [options]
   * @returns {Promise<Blob>}
   */
  async function build(pages, options = {}) {
    const {
      title = 'Waklink',
      quality = 0.82,
      maxWidth = 1600,
      signal,
      onProgress,
    } = options;

    if (!pages?.length) throw new Error('Aucune planche à assembler.');

    const writer = createWriter();
    const offsets = [];
    writer.push('%PDF-1.7\n');
    // Commentaire binaire : signale aux outils que le fichier n'est pas du texte.
    writer.push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    // 1 = catalogue, 2 = arbre des pages, 3 = métadonnées, puis 3 objets par planche.
    const FIRST = 4;
    const total = pages.length;
    const kids = [];
    let bytes = 0;

    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw abortError();

      const { jpeg, width, height } = await rasterize(pages[i], { quality, maxWidth, signal });
      bytes += jpeg.size;

      const pageNum = FIRST + i * 3;
      const contentNum = pageNum + 1;
      const imageNum = pageNum + 2;
      const boxWidth = PAGE_WIDTH;
      const boxHeight = round2((PAGE_WIDTH * height) / width);

      kids.push(`${pageNum} 0 R`);

      writeObject(writer, offsets, pageNum,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${boxWidth} ${boxHeight}] ` +
        `/Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`);

      const content = `q ${boxWidth} 0 0 ${boxHeight} 0 0 cm /Im0 Do Q`;
      writeObject(writer, offsets, contentNum,
        `<< /Length ${encoder.encode(content).byteLength} >>`, content);

      writeObject(writer, offsets, imageNum,
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.size} >>`,
        jpeg);

      onProgress?.(i + 1, total, bytes);
      // Laisse respirer le rendu : la barre de progression reste fluide.
      await new Promise((r) => setTimeout(r, 0));
    }

    if (signal?.aborted) throw abortError();

    writeObject(writer, offsets, 1, '<< /Type /Catalog /Pages 2 0 R >>');
    writeObject(writer, offsets, 2, `<< /Type /Pages /Count ${total} /Kids [${kids.join(' ')}] >>`);
    writeObject(writer, offsets, 3,
      `<< /Title ${textString(title)} /Creator ${textString('Waklink')} ` +
      `/Producer ${textString('Waklink')} /CreationDate (${pdfDate(new Date())}) >>`);

    const size = FIRST + total * 3;
    const startxref = writer.offset;
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
    for (let num = 1; num < size; num++) xref += `${pad10(offsets[num] ?? 0)} 00000 n \n`;
    writer.push(xref);
    writer.push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

    return new Blob(writer.parts, { type: 'application/pdf' });
  }

  /**
   * Poids probable du PDF à partir du poids des sources. Le JPEG compresse
   * moins bien que le webp : mesuré à ×1,16 sur le tome 1 (113 Mo → 131 Mo).
   */
  const estimate = (sourceBytes) => Math.round(sourceBytes * 1.16);

  window.WaklinkPdf = { build, estimate };
})();
