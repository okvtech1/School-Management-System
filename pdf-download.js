/*******************************************************************
 * SMS PDF DOWNLOAD — one tap saves the result sheet as a real A4 PDF that looks EXACTLY like the sheet on screen
 * (school logo, colours, student photo, signatures and all), so a parent does not have to use the print dialog.
 *
 * How: the sheet (an element sized to A4) is drawn to an image at 3x resolution with html-to-image, then placed on
 * a single A4 page with pdf-lib. Both libraries are bundled in /vendor (MIT licence) and load only when needed.
 * If anything fails (very old browser), it falls back to the browser's own print dialog, where "Save as PDF" works.
 *******************************************************************/
(function(){
  const A4_W_PT = 595.28, A4_H_PT = 841.89;
  const loaded = {};
  function loadScript(src){
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
    return loaded[src];
  }
  async function ensureLibs(){
    if (!window.htmlToImage) await loadScript('vendor/html-to-image.js');
    if (!window.PDFLib) await loadScript('vendor/pdf-lib.min.js');
  }
  function safeName(s){ return String(s || 'result').replace(/[^A-Za-z0-9._ -]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'result'; }

  // paperEl = the A4 sheet element (.rs-paper). Returns { ok:true } or { ok:false, error }.
  async function downloadPaper(paperEl, filename, opts){
    opts = opts || {};
    try {
      if (!paperEl) throw new Error('Nothing to download yet.');
      await ensureLibs();
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      // Capture the paper at its true size, ignoring any on-screen scaling or shadow.
      const w = paperEl.offsetWidth, h = paperEl.offsetHeight;
      const canvas = await window.htmlToImage.toCanvas(paperEl, {
        pixelRatio: 3, width: w, height: h, backgroundColor: '#ffffff', cacheBust: false,
        style: { transform: 'none', boxShadow: 'none', margin: '0' }
      });
      const jpg = canvas.toDataURL('image/jpeg', 0.93);
      const { PDFDocument } = window.PDFLib;
      const pdf = await PDFDocument.create();
      pdf.setTitle(opts.title || filename); pdf.setAuthor(opts.author || ''); pdf.setCreator('OKV School Management System');
      const img = await pdf.embedJpg(jpg);
      const page = pdf.addPage([A4_W_PT, A4_H_PT]);
      // Fit the paper to the page width (it is already A4-proportioned), pinned to the top.
      const scale = A4_W_PT / img.width;
      const drawH = Math.min(A4_H_PT, img.height * scale);
      page.drawImage(img, { x: 0, y: A4_H_PT - drawH, width: A4_W_PT, height: drawH });
      const bytes = await pdf.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = safeName(filename) + '.pdf';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
      // Some phone browsers ignore the download attribute; offer the file in a new tab as well.
      if (opts.openFallback && /iPhone|iPad|iPod/i.test(navigator.userAgent)) window.open(URL.createObjectURL(blob), '_blank');
      return { ok: true, bytes: bytes.length };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }
  window.smsPdf = { downloadPaper, safeName };
})();
