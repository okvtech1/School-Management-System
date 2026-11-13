/*******************************************************************
 * SMS CHARTS LIBRARY — small, dependency-free charts used by every dashboard
 * (school Home tab for each role, and the platform owner Overview).
 *
 * Why not Chart.js: it needs a CDN, so charts would vanish offline (this system is offline-first)
 * and could not be tested without internet. These are plain SVG/HTML, light, print-friendly, work
 * offline, scale to any screen, and show a value tooltip on hover/tap.
 *
 *   smsCharts.bar(el,   { labels, series:[{name, values, color}], format, height })      vertical (grouped) bars
 *   smsCharts.hbar(el,  { labels, values, colors, format, max })                          horizontal bars
 *   smsCharts.donut(el, { labels, values, colors, format, center:{value,label} })         doughnut + legend
 *   smsCharts.line(el,  { labels, series:[{name, values, color}], format, height, min })  line + area
 *   smsCharts.ring(el,  { value, max, label, color, format })                              single-value progress ring
 *   smsCharts.empty(el, message)                                                           friendly "no data yet"
 *   smsCharts.fmt.money / fmt.num / fmt.pct                                                value formatters
 *******************************************************************/
(function(){
  const PALETTE = ['#14213D','#B8863B','#1E6B3A','#8B1E3F','#1D5C8C','#C9A227','#0F6B6F','#5B2A86'];
  const GRADE_COLORS = { A:'#1E6B3A', B:'#2F8F6B', C:'#C9A227', D:'#E08A1E', E:'#C0502F', F:'#8B1E3F' };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  /* ---------- formatters ---------- */
  const fmt = {
    num: n => Number(n || 0).toLocaleString(),
    pct: n => (Math.round(Number(n || 0) * 10) / 10) + '%',
    // ₦1,250 -> ₦1.3K ; ₦2,400,000 -> ₦2.4M (compact, for axes and tight spaces)
    money: n => {
      n = Number(n || 0); const a = Math.abs(n), s = n < 0 ? '-' : '';
      if (a >= 1e9) return s + '₦' + (a / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
      if (a >= 1e6) return s + '₦' + (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
      if (a >= 1e3) return s + '₦' + (a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
      return s + '₦' + Math.round(a);
    },
    moneyFull: n => '₦' + Math.round(Number(n || 0)).toLocaleString()
  };

  /* ---------- styles (injected once) ---------- */
  function css(){
    if (document.getElementById('sc-css')) return;
    const st = document.createElement('style'); st.id = 'sc-css';
    st.textContent = `
      .sc-svg{width:100%;height:auto;display:block;overflow:visible;}
      .sc-svg text{font-family:system-ui,sans-serif;fill:#7a7259;}
      .sc-grid{stroke:#ECE4D0;stroke-width:1;}
      .sc-axis{stroke:#cfc6aa;stroke-width:1;}
      .sc-bar{transition:opacity .15s;} .sc-bar:hover{opacity:.78;}
      .sc-val{font-size:10px;font-weight:700;fill:#14213D !important;}
      .sc-lbl{font-size:10px;} .sc-tick{font-size:9.5px;}
      .sc-legend{display:flex;flex-wrap:wrap;gap:.3rem .8rem;margin-top:.55rem;font-size:.74rem;color:#5b5442;}
      .sc-legend span{display:inline-flex;align-items:center;gap:.3rem;white-space:nowrap;}
      .sc-legend i{display:inline-block;width:10px;height:10px;border-radius:3px;}
      .sc-empty{padding:1.6rem .5rem;text-align:center;font-size:.8rem;color:#9a9078;background:#FBF8F0;border:1px dashed #DCD0B4;border-radius:10px;}
      .sc-hrow{display:grid;grid-template-columns:minmax(84px,38%) 1fr;align-items:center;gap:.5rem;margin-bottom:.42rem;font-size:.78rem;}
      .sc-hrow .sc-hname{color:#3d3826;font-weight:600;line-height:1.15;overflow-wrap:anywhere;}
      .sc-htrack{position:relative;background:#F1E7D3;border-radius:6px;height:20px;overflow:hidden;}
      .sc-hfill{height:100%;border-radius:6px;transition:width .4s;}
      .sc-hval{position:absolute;right:6px;top:0;line-height:20px;font-size:.72rem;font-weight:800;color:#14213D;}
      .sc-donut-wrap{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;justify-content:center;}
      .sc-donut-wrap svg{width:150px;height:150px;flex:none;}
      .sc-ring-wrap{display:flex;align-items:center;gap:.8rem;}
    `;
    document.head.appendChild(st);
  }

  function niceMax(v){
    if (v <= 0) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / pow;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * pow;
  }
  // Axis top: for small whole-number data (counts) use a multiple of 4 so every grid line is a whole number.
  function axisMax(values){
    const mx = Math.max(0, ...values.map(Number));
    if (values.every(v => Number.isInteger(Number(v))) && mx <= 40) return Math.max(4, Math.ceil(mx / 4) * 4);
    return niceMax(mx);
  }
  const total = a => a.reduce((s, v) => s + (Number(v) || 0), 0);
  const anyData = a => a.some(v => Number(v) > 0);

  function empty(el, message){ css(); el.innerHTML = `<div class="sc-empty">${esc(message || 'No data yet.')}</div>`; }

  /* ---------- vertical grouped bars ---------- */
  function bar(el, o){
    css();
    const series = o.series || [{ name: '', values: o.values || [], color: PALETTE[0] }];
    if (!series.some(s => anyData(s.values))) return empty(el, o.emptyText);
    const f = o.format || fmt.num, labels = o.labels || [];
    const W = 460, H = o.height || 200, ml = 40, mr = 8, mt = 16, mb = 28;
    const ymax = axisMax([].concat(...series.map(s => s.values)));
    const pw = W - ml - mr, ph = H - mt - mb;
    const n = labels.length, gw = pw / Math.max(1, n), bw = Math.min(30, (gw * 0.72) / series.length);
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const y = mt + ph - (ph * i / 4);
      g += `<line class="sc-grid" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="sc-tick" x="${ml - 5}" y="${y + 3}" text-anchor="end">${esc(f(ymax * i / 4))}</text>`;
    }
    let bars = '', xl = '';
    labels.forEach((lab, i) => {
      const cx = ml + gw * i + gw / 2;
      series.forEach((s, k) => {
        const v = Number(s.values[i]) || 0, h = ph * v / ymax;
        const x = cx - (bw * series.length) / 2 + k * bw;
        const col = s.color || PALETTE[k % PALETTE.length];
        bars += `<rect class="sc-bar" x="${x.toFixed(1)}" y="${(mt + ph - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" fill="${col}"><title>${esc(lab)}${s.name ? ' — ' + esc(s.name) : ''}: ${esc(f(v))}</title></rect>`;
        if (n <= 8 && v > 0 && series.length === 1) bars += `<text class="sc-val" x="${(x + (bw - 2) / 2).toFixed(1)}" y="${(mt + ph - h - 4).toFixed(1)}" text-anchor="middle">${esc(f(v))}</text>`;
      });
      xl += `<text class="sc-lbl" x="${cx.toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(lab)}</text>`;
    });
    const legend = series.length > 1 ? `<div class="sc-legend">${series.map((s, k) => `<span><i style="background:${s.color || PALETTE[k % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    el.innerHTML = `<svg class="sc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Bar chart')}">${g}<line class="sc-axis" x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}"/>${bars}${xl}</svg>${legend}`;
  }

  /* ---------- horizontal bars (many categories, small screens) ---------- */
  function hbar(el, o){
    css();
    const values = (o.values || []).map(Number), labels = o.labels || [];
    if (!values.length || !anyData(values)) return empty(el, o.emptyText);
    const f = o.format || fmt.num, max = o.max || Math.max(...values, 1);
    el.innerHTML = labels.map((lab, i) => {
      const v = values[i] || 0, pct = Math.max(2, Math.min(100, v / max * 100));
      const col = (o.colors && o.colors[i]) || o.color || PALETTE[0];
      // Bars stop 46px short of the right edge so the value label never sits on top of a bar.
      return `<div class="sc-hrow" title="${esc(lab)}: ${esc(f(v))}"><div class="sc-hname">${esc(lab)}</div><div class="sc-htrack"><div class="sc-hfill" style="width:calc((100% - 46px) * ${(pct / 100).toFixed(4)});background:${col}"></div><span class="sc-hval">${esc(f(v))}</span></div></div>`;
    }).join('');
  }

  /* ---------- donut + legend ---------- */
  function donut(el, o){
    css();
    const values = (o.values || []).map(Number), labels = o.labels || [];
    const sum = total(values);
    if (!sum) return empty(el, o.emptyText);
    const f = o.format || fmt.num, R = 52, C = 2 * Math.PI * R;
    let off = 0, arcs = '';
    values.forEach((v, i) => {
      if (v <= 0) return;
      const len = C * v / sum, col = (o.colors && o.colors[i]) || PALETTE[i % PALETTE.length];
      arcs += `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${col}" stroke-width="22" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 70 70)"><title>${esc(labels[i])}: ${esc(f(v))} (${Math.round(v / sum * 100)}%)</title></circle>`;
      off += len;
    });
    const c = o.center || { value: f(sum), label: 'Total' };
    const legend = labels.map((lab, i) => `<span><i style="background:${(o.colors && o.colors[i]) || PALETTE[i % PALETTE.length]}"></i>${esc(lab)}: <b>${esc(f(values[i] || 0))}</b> (${Math.round((values[i] || 0) / sum * 100)}%)</span>`).join('');
    el.innerHTML = `<div class="sc-donut-wrap"><svg viewBox="0 0 140 140" role="img" aria-label="${esc(o.title || 'Doughnut chart')}">${arcs}<text x="70" y="68" text-anchor="middle" style="font-size:19px;font-weight:800;fill:#14213D">${esc(c.value)}</text><text x="70" y="84" text-anchor="middle" style="font-size:9px;letter-spacing:.05em;text-transform:uppercase">${esc(c.label)}</text></svg><div class="sc-legend" style="flex-direction:column;margin:0;">${legend}</div></div>`;
  }

  /* ---------- line + area ---------- */
  function line(el, o){
    css();
    const series = o.series || [{ name: '', values: o.values || [], color: PALETTE[0] }], labels = o.labels || [];
    const all = [].concat(...series.map(s => s.values.map(Number)));
    if (all.length < 2 || !anyData(all)) return empty(el, o.emptyText);
    const f = o.format || fmt.num, W = 460, H = o.height || 190, ml = 40, mr = 14, mt = 16, mb = 28;
    const hi = Math.max(...all), lo = o.min != null ? o.min : 0, ymax = axisMax(all), ymin = Math.min(lo, 0) || 0;
    const pw = W - ml - mr, ph = H - mt - mb, n = labels.length;
    const X = i => ml + (n === 1 ? pw / 2 : pw * i / (n - 1)), Y = v => mt + ph - ph * (v - ymin) / ((ymax - ymin) || 1);
    let g = '';
    for (let i = 0; i <= 4; i++) { const y = mt + ph - ph * i / 4; g += `<line class="sc-grid" x1="${ml}" x2="${W - mr}" y1="${y}" y2="${y}"/><text class="sc-tick" x="${ml - 5}" y="${y + 3}" text-anchor="end">${esc(f(ymin + (ymax - ymin) * i / 4))}</text>`; }
    let paths = '', dots = '';
    series.forEach((s, k) => {
      const col = s.color || PALETTE[k % PALETTE.length];
      const pts = s.values.map((v, i) => `${X(i).toFixed(1)},${Y(Number(v) || 0).toFixed(1)}`);
      paths += `<path d="M${pts.join(' L')} L${X(s.values.length - 1).toFixed(1)},${mt + ph} L${X(0).toFixed(1)},${mt + ph} Z" fill="${col}" opacity=".10"/><path d="M${pts.join(' L')}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
      s.values.forEach((v, i) => { dots += `<circle cx="${X(i).toFixed(1)}" cy="${Y(Number(v) || 0).toFixed(1)}" r="3.6" fill="#fff" stroke="${col}" stroke-width="2"><title>${esc(labels[i])}${s.name ? ' — ' + esc(s.name) : ''}: ${esc(f(v))}</title></circle>`; });
    });
    const xl = labels.map((lab, i) => `<text class="sc-lbl" x="${X(i).toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(lab)}</text>`).join('');
    const legend = series.length > 1 ? `<div class="sc-legend">${series.map((s, k) => `<span><i style="background:${s.color || PALETTE[k % PALETTE.length]}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
    el.innerHTML = `<svg class="sc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Line chart')}">${g}<line class="sc-axis" x1="${ml}" x2="${W - mr}" y1="${mt + ph}" y2="${mt + ph}"/>${paths}${dots}${xl}</svg>${legend}`;
  }

  /* ---------- single-value ring ---------- */
  function ring(el, o){
    css();
    const max = o.max || 100, v = Math.max(0, Math.min(max, Number(o.value) || 0)), R = 34, C = 2 * Math.PI * R;
    const col = o.color || PALETTE[2], f = o.format || (n => Math.round(n) + '%');
    el.innerHTML = `<div class="sc-ring-wrap"><svg viewBox="0 0 90 90" style="width:84px;height:84px;flex:none" role="img" aria-label="${esc(o.label || 'Progress')}"><circle cx="45" cy="45" r="${R}" fill="none" stroke="#F1E7D3" stroke-width="10"/><circle cx="45" cy="45" r="${R}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(C * v / max).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 45 45)"/><text x="45" y="50" text-anchor="middle" style="font-size:16px;font-weight:800;fill:#14213D">${esc(f(v))}</text></svg><div style="font-size:.8rem;color:#5b5442;">${esc(o.label || '')}</div></div>`;
  }

  window.smsCharts = { bar, hbar, donut, line, ring, empty, fmt, PALETTE, GRADE_COLORS };
})();
