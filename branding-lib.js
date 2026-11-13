/*******************************************************************
 * PUBLIC BRANDING LOADER — include on any public marketing page that
 * uses the --navy/--gold CSS custom properties and a .brand/.seal
 * header element. Pulls live branding from Platform Config
 * (publicGetPlatformConfig) so Victor's Super Admin dashboard
 * actually changes what visitors see, instead of just being stored.
 *
 * Silently does nothing if no branding has been configured, or if
 * the request fails — the page's own hardcoded defaults always win
 * as the fallback, so this can never break the page.
 *******************************************************************/
(function(){
  const API_URL = window.SMS_API_URL || (window.SMS_CONFIG && window.SMS_CONFIG.apiUrl) || '';

  function darken(hex, amount){
    try {
      const n = parseInt(hex.replace('#',''), 16);
      let r = (n >> 16) - amount, g = ((n >> 8) & 0xff) - amount, b = (n & 0xff) - amount;
      r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    } catch (e) { return hex; }
  }

  async function applyBranding(){
    try {
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'publicGetPlatformConfig' })
      });
      const resp = await res.json();
      if (!resp.ok || !resp.branding) return;
      const b = resp.branding;
      const root = document.documentElement.style;

      if (b.primaryColor) {
        root.setProperty('--navy', b.primaryColor);
        root.setProperty('--navy2', darken(b.primaryColor, -20)); // slightly lighter, for hover states
      }
      if (b.secondaryColor) {
        root.setProperty('--gold', b.secondaryColor);
        root.setProperty('--gold2', darken(b.secondaryColor, 25));
      }
      if (b.siteName) {
        document.querySelectorAll('.brand').forEach(el => {
          const sealEl = el.querySelector('.seal');
          el.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = ' ' + b.siteName; });
          if (!sealEl) el.textContent = b.siteName;
        });
        if (document.title.includes('OKV School Management System')) {
          document.title = document.title.replace('OKV School Management System', b.siteName);
        }
      }
      if (b.logoUrl) {
        document.querySelectorAll('.brand .seal').forEach(sealEl => {
          const img = document.createElement('img');
          img.src = b.logoUrl;
          img.alt = b.siteName || 'Logo';
          img.style.cssText = 'height:32px;width:auto;border-radius:6px;';
          sealEl.replaceWith(img);
        });
      }
    } catch (err) { /* keep the page's own defaults */ }
  }

  applyBranding();
})();
