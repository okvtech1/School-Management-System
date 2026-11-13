/*******************************************************************
 * SMS PRINT LIBRARY — one place for how every school printable looks.
 *
 * Gives result sheets, passcode slips, clearance lists, ID cards, reports,
 * timetables and receipts the same school identity:
 *   - the school's LOGO at the top LEFT of the letterhead
 *   - the school's own COLOURS (primary + accent) instead of fixed ones
 *   - school info: name, address, phone, email, website, registration no., motto
 *   - an optional second logo (top right), footer note and logo watermark
 *   - A4 PORTRAIT page rules so everything prints at the right size
 *
 * Settings fields it reads (all optional, all set on the Settings page):
 *   schoolName, schoolLogo, schoolLogo2, schoolAddress, schoolPhone, schoolEmail,
 *   schoolWebsite, schoolRegNo, schoolMotto, brandPrimary, brandAccent,
 *   printFooter, printWatermark
 * Public pages receive the same fields from the server (see Code.gs).
 *******************************************************************/
(function(){
  const DEFAULT_PRIMARY = '#7a1620';   // the colour result sheets have always used
  const DEFAULT_ACCENT = '#B8863B';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  /* ---------- colour helpers ---------- */
  function cleanHex(h, fallback){
    h = String(h || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(h)) return h.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(h)) return ('#' + h[1]+h[1] + h[2]+h[2] + h[3]+h[3]).toLowerCase();
    return fallback;
  }
  function rgb(h){ const n = parseInt(h.slice(1), 16); return [(n>>16)&255, (n>>8)&255, n&255]; }
  function toHex(r,g,b){ return '#' + [r,g,b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2,'0')).join(''); }
  // Mixes a colour with white (amount 0..1 = how much white). Used for soft header tints.
  function tint(h, amount){ const [r,g,b] = rgb(h); return toHex(r + (255-r)*amount, g + (255-g)*amount, b + (255-b)*amount); }
  // Darkens a colour (amount 0..1 = how much black).
  function shade(h, amount){ const [r,g,b] = rgb(h); return toHex(r*(1-amount), g*(1-amount), b*(1-amount)); }
  // Black or white text, whichever reads better on this background.
  function contrast(h){ const [r,g,b] = rgb(h); return (0.299*r + 0.587*g + 0.114*b) > 150 ? '#14213D' : '#ffffff'; }

  /* ---------- brand object ---------- */
  // Accepts a settings payload OR the flat school fields the server sends to public pages.
  function brand(src){
    src = src || {};
    const primary = cleanHex(src.brandPrimary, DEFAULT_PRIMARY);
    const accent = cleanHex(src.brandAccent, DEFAULT_ACCENT);
    const pick = (a, b) => (src[a] !== undefined && src[a] !== null && src[a] !== '') ? src[a] : (src[b] || '');
    return {
      name: pick('schoolName', 'name'), logo: pick('schoolLogo', 'logo'), logo2: pick('schoolLogo2', 'logo2'),
      address: pick('schoolAddress', 'address'), phone: pick('schoolPhone', 'phone'), email: pick('schoolEmail', 'email'),
      website: pick('schoolWebsite', 'website'), regNo: pick('schoolRegNo', 'regNo'), motto: pick('schoolMotto', 'motto'),
      footer: pick('printFooter', 'footer'), watermark: !!(src.printWatermark || src.watermark),
      primary, accent, tint: tint(primary, 0.9), tintStrong: tint(primary, 0.78), dark: shade(primary, 0.25),
      onPrimary: contrast(primary), onAccent: contrast(accent)
    };
  }

  /* ---------- CSS ---------- */
  // Variables every printable can use: var(--sch-primary), var(--sch-tint), var(--sch-accent) ...
  function varsCss(b, scope){
    scope = scope || ':root';
    return `${scope}{--sch-primary:${b.primary};--sch-dark:${b.dark};--sch-tint:${b.tint};--sch-tint2:${b.tintStrong};--sch-accent:${b.accent};--sch-on-primary:${b.onPrimary};--sch-on-accent:${b.onAccent};}`;
  }

  // Letterhead styling shared by every printable. Sizes are in mm/pt so the paper size is respected exactly.
  const LETTERHEAD_CSS = `
    .sch-lh{display:flex;align-items:center;gap:4mm;padding-bottom:2.2mm;border-bottom:1.1mm solid var(--sch-primary);position:relative;}
    .sch-lh::after{content:"";position:absolute;left:0;right:0;bottom:-2.3mm;height:.5mm;background:var(--sch-accent);}
    .sch-lh .sch-logo{width:22mm;height:22mm;object-fit:contain;flex:none;}
    .sch-lh .sch-logo.sch-logo-empty{border:.3mm dashed #c9c1ad;border-radius:2mm;}
    .sch-lh .sch-logo2{width:20mm;height:20mm;object-fit:contain;flex:none;margin-left:auto;}
    .sch-lh .sch-id{flex:1;min-width:0;text-align:left;}
    .sch-lh .sch-name{font-size:17pt;line-height:1.12;font-weight:800;color:var(--sch-primary);letter-spacing:.01em;text-transform:uppercase;}
    .sch-lh .sch-line{font-size:8.2pt;line-height:1.35;color:#333;margin-top:.6mm;}
    .sch-lh .sch-motto{font-size:8.4pt;font-weight:700;color:var(--sch-primary);font-style:italic;margin-top:.8mm;}
    .sch-lh.sch-compact .sch-logo{width:15mm;height:15mm;} .sch-lh.sch-compact .sch-logo2{width:14mm;height:14mm;}
    .sch-lh.sch-compact .sch-name{font-size:13pt;} .sch-lh.sch-compact .sch-line{font-size:7.4pt;}
    .sch-foot{margin-top:4mm;padding-top:1.6mm;border-top:.3mm solid #bbb;font-size:7.4pt;color:#555;text-align:center;line-height:1.35;}
    .sch-foot b{color:var(--sch-primary);}
    .sch-watermark{position:relative;}
    .sch-watermark::before{content:"";position:absolute;inset:0;background:var(--sch-wm) center 55% / 60% no-repeat;opacity:.06;pointer-events:none;z-index:0;}
    .sch-watermark > *{position:relative;z-index:1;}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  `;

  // A4 portrait page rules. Margins are 10mm all round, so the printable area is 190mm x 277mm.
  const PAGE_CSS = `@page{size:A4 portrait;margin:10mm;}`;

  const injected = {};
  function injectOnce(id, css){
    if (injected[id] || document.getElementById(id)) return;
    const el = document.createElement('style'); el.id = id; el.textContent = css; document.head.appendChild(el); injected[id] = true;
  }
  // Call once on a page that prints: sets the school's colours and the A4 portrait page rule.
  function applyTheme(b, opts){
    opts = opts || {};
    let el = document.getElementById('sch-theme-vars');
    if (!el){ el = document.createElement('style'); el.id = 'sch-theme-vars'; document.head.appendChild(el); }
    el.textContent = varsCss(b) + (b.watermark && b.logo ? `:root{--sch-wm:url("${b.logo}");}` : '');
    injectOnce('sch-letterhead-css', LETTERHEAD_CSS);
    if (opts.page !== false) injectOnce('sch-page-css', PAGE_CSS);
  }

  /* ---------- HTML pieces ---------- */
  // The standard letterhead: LOGO TOP-LEFT, then school name and details. opts.right = custom html for the right
  // edge (e.g. the student's photo); otherwise the optional second logo shows there.
  function letterhead(b, opts){
    opts = opts || {};
    const contact = [b.phone, b.email, b.website].filter(Boolean).map(esc).join('  |  ');
    const right = opts.right !== undefined ? opts.right : (b.logo2 ? `<img class="sch-logo2" src="${esc(b.logo2)}" alt="">` : '');
    return `
      <div class="sch-lh${opts.compact ? ' sch-compact' : ''}">
        ${b.logo ? `<img class="sch-logo" src="${esc(b.logo)}" alt="School logo">` : (opts.showEmptyLogo ? '<div class="sch-logo sch-logo-empty"></div>' : '')}
        <div class="sch-id">
          <div class="sch-name">${esc(b.name || 'School Name')}</div>
          ${b.address ? `<div class="sch-line">${esc(b.address)}</div>` : ''}
          ${contact ? `<div class="sch-line">${contact}</div>` : ''}
          ${b.regNo ? `<div class="sch-line"><b>${esc(b.regNo)}</b></div>` : ''}
          ${b.motto ? `<div class="sch-motto">&ldquo;${esc(b.motto)}&rdquo;</div>` : ''}
        </div>
        ${right}
      </div>`;
  }

  // Optional footer line (custom note from Settings). Empty string if the school set none.
  function footer(b, extra){
    const parts = [];
    if (b.footer) parts.push(esc(b.footer));
    if (extra) parts.push(extra);
    return parts.length ? `<div class="sch-foot">${parts.join('<br>')}</div>` : '';
  }

  // Loads the school's settings (staff pages) and returns a brand object.
  async function loadBrand(){
    try {
      const s = await window.smsSettings.getSettings();
      return { brand: brand(s.payload), settings: s.payload };
    } catch (e) { return { brand: brand({}), settings: {} }; }
  }

  // Ready-made colour themes shown on the Settings page.
  const PRESETS = [
    { name: 'Wine & Gold',   primary: '#7a1620', accent: '#B8863B' },
    { name: 'Navy & Gold',   primary: '#14213D', accent: '#B8863B' },
    { name: 'Forest Green',  primary: '#1E6B3A', accent: '#C9A227' },
    { name: 'Royal Blue',    primary: '#1F4E9C', accent: '#E0A100' },
    { name: 'Purple',        primary: '#5B2A86', accent: '#D4A017' },
    { name: 'Teal',          primary: '#0F6B6F', accent: '#E07A1F' },
    { name: 'Crimson',       primary: '#B3202A', accent: '#14213D' },
    { name: 'Charcoal',      primary: '#2F3640', accent: '#C0392B' }
  ];


  /* ---------- "Print this page" documents (reports, cash-flow, timetable) ----------
     The page keeps its normal on-screen look. When printed, a branded letterhead + document title +
     optional info boxes appear on top, the screen-only controls disappear, and the paper is A4 portrait. */
  const PAGEHEAD_CSS = `
    #sch-print-head,#sch-print-foot{display:none;}
    .sch-doc-title{margin-top:6mm;background:var(--sch-primary);color:var(--sch-on-primary);text-align:center;font-weight:800;font-size:11pt;letter-spacing:.1em;padding:2.4mm 0;border-radius:1mm;text-transform:uppercase;}
    .sch-doc-meta{display:flex;gap:3mm;margin-top:4mm;flex-wrap:wrap;}
    .sch-doc-meta div{background:#f6f6f4;border:.25mm solid #d6d3c8;border-radius:1.2mm;padding:1.7mm 3mm;font-size:8.8pt;min-width:30mm;}
    .sch-doc-meta .k{display:block;font-size:5.9pt;letter-spacing:.09em;color:#6b6b6b;text-transform:uppercase;font-weight:700;margin-bottom:.6mm;}
    .sch-doc-meta .v{font-weight:700;}
    @media print{
      #sch-print-head{display:block;margin-bottom:6mm;font-family:"Segoe UI",Arial,sans-serif;}
      #sch-print-foot{display:block;margin-top:6mm;font-family:"Segoe UI",Arial,sans-serif;}
      html,body{background:#fff !important;padding:0 !important;margin:0 !important;}
      .wrap{max-width:none !important;margin:0 !important;padding:0 !important;}
      .card-panel{box-shadow:none !important;border:none !important;padding:0 !important;margin-bottom:4mm !important;}
      .no-print,.topline,#offlineBanner{display:none !important;}
      table{break-inside:auto;} tr{break-inside:avoid;page-break-inside:avoid;}
    }
  `;
  // opts: { title, meta: [[label, value], ...], footerExtra }
  function preparePage(b, opts){
    opts = opts || {};
    applyTheme(b);
    injectOnce('sch-pagehead-css', PAGEHEAD_CSS);
    let head = document.getElementById('sch-print-head');
    if (!head){ head = document.createElement('div'); head.id = 'sch-print-head'; document.body.insertBefore(head, document.body.firstChild); }
    const meta = (opts.meta || []).filter(m => m && m[1] !== undefined && m[1] !== '');
    head.innerHTML = letterhead(b) + `<div class="sch-doc-title">${esc(opts.title || '')}</div>` +
      (meta.length ? `<div class="sch-doc-meta">${meta.map(m => `<div><span class="k">${esc(m[0])}</span><span class="v">${esc(m[1])}</span></div>`).join('')}</div>` : '');
    let foot = document.getElementById('sch-print-foot');
    if (!foot){ foot = document.createElement('div'); foot.id = 'sch-print-foot'; document.body.appendChild(foot); }
    foot.innerHTML = footer(b, (opts.footerExtra ? esc(opts.footerExtra) + '<br>' : '') + 'Printed ' + esc(new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })));
  }
  // Wires up a page: getOpts() is called right before every print (button or Ctrl+P) so the header is always current.
  async function attachPage(getOpts){
    const { brand: b } = await loadBrand();
    const run = () => preparePage(b, getOpts());
    window.addEventListener('beforeprint', run);
    run();
    return run;
  }

  window.smsPrint = { preparePage, attachPage, brand, applyTheme, varsCss, letterhead, footer, loadBrand, tint, shade, contrast, cleanHex, esc, PRESETS,
                      DEFAULT_PRIMARY, DEFAULT_ACCENT, LETTERHEAD_CSS, PAGE_CSS };
})();
