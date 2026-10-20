/*******************************************************************
 * SMS IMAGE LIBRARY — shrinks every uploaded picture to a size that is guaranteed to fit.
 *
 * Why: records are stored as JSON in ONE Google Sheets cell, and a cell holds at most 50,000
 * characters. A phone-camera receipt, a detailed logo or a screenshot easily exceeds that, which used
 * to make the save fail. Here every image is re-encoded, stepping the size and quality down until the
 * data URL fits a character BUDGET:
 *   small images (photos, logos, signatures)  ->  14,000 characters by default
 *   large images (receipts, screenshots)      ->  44,000 characters by default
 * (the school settings record holds the logo, second logo AND signature together, so each must stay small).
 *
 * Usage (kept compatible with the old per-page helper):
 *   await resizeImageToDataUrl(file, maxW, maxH [, maxChars])
 *******************************************************************/
(function(){
  const SMALL_BUDGET = 14000, LARGE_BUDGET = 44000;
  const SCALES = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.25];
  const QUALITIES = [0.8, 0.65, 0.5, 0.4, 0.3];

  function loadImage(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = ev => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = ev.target.result; };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function draw(img, maxW, maxH, scale, whiteBg){
    const ratio = Math.min((maxW * scale) / img.width, (maxH * scale) / img.height, 1);
    const w = Math.max(1, Math.round(img.width * ratio)), h = Math.max(1, Math.round(img.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (whiteBg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  async function compress(file, opts){
    opts = opts || {};
    const maxW = opts.maxW || 800, maxH = opts.maxH || 800;
    const budget = opts.maxChars || ((maxW * maxH) <= 90000 ? SMALL_BUDGET : LARGE_BUDGET);
    const img = await loadImage(file);
    // PNG keeps transparency (logos, signatures); photos and scans go straight to JPEG.
    const mayHaveAlpha = /png|gif|webp|svg/i.test(file.type || '');
    let best = null;
    for (const scale of SCALES) {
      if (mayHaveAlpha) {
        const png = draw(img, maxW, maxH, scale, false).toDataURL('image/png');
        if (png.length <= budget) return png;
        if (!best || png.length < best.length) best = png;
      }
      const canvas = draw(img, maxW, maxH, scale, true);
      for (const q of QUALITIES) {
        const jpg = canvas.toDataURL('image/jpeg', q);
        if (jpg.length <= budget) return jpg;
        if (!best || jpg.length < best.length) best = jpg;
      }
    }
    if (best && best.length <= budget * 1.05) return best;
    throw new Error('This image is too detailed to shrink enough. Please choose a simpler or smaller picture.');
  }

  window.smsImg = { compress, SMALL_BUDGET, LARGE_BUDGET };
  window.resizeImageToDataUrl = (file, maxW, maxH, maxChars) => compress(file, { maxW, maxH, maxChars });
})();
