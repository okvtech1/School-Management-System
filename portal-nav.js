/*******************************************************************
 * PORTAL NAV — shared tab bar for the public pages (result-check.html,
 * cbt-exam.html, pay-fees.html, portal.html). Include after setting
 * window.SMS_API_URL and before calling renderPortalNav(activeKey).
 *******************************************************************/
function renderPortalNav(activeKey){
  const params = new URLSearchParams(window.location.search);
  const orgId = params.get('org') || '';
  const qs = orgId ? `?org=${encodeURIComponent(orgId)}` : '';

  // Remember this as "home" for the installed icon on this device — see the
  // smart-redirect note in login.html for why this matters.
  try { localStorage.setItem('sms_pwa_home', window.location.pathname.split('/').pop() + window.location.search); } catch(e){}

  const tabs = [
    { key: 'portal', label: 'Home', icon: 'bi-house', href: `portal.html${qs}` },
    { key: 'result',  label: 'Check Result', icon: 'bi-file-earmark-text', href: `result-check.html${qs}` },
    { key: 'assignment', label: 'Assignments', icon: 'bi-journal-text', href: `assignment-check.html${qs}` },
    { key: 'cbt',     label: 'CBT Test/Exam', icon: 'bi-laptop', href: `cbt-exam.html${qs}` },
    { key: 'pay',     label: 'Pay Fees', icon: 'bi-credit-card', href: `pay-fees.html${qs}` },
    { key: 'help',    label: 'Help', icon: 'bi-question-circle', href: `guide.html${qs}` }
  ];

  const nav = document.createElement('div');
  nav.id = 'portalNav';
  nav.style.cssText = 'max-width:640px;margin:0 auto 1rem;display:flex;gap:.4rem;overflow-x:auto;padding-bottom:.2rem;';
  nav.innerHTML = tabs.map(t => `
    <a href="${t.href}" style="flex:1;min-width:84px;text-align:center;text-decoration:none;
      background:${t.key===activeKey ? '#B8863B' : 'rgba(255,255,255,.12)'};
      color:${t.key===activeKey ? '#14213D' : '#fff'};
      font-weight:700;font-size:.75rem;padding:.55em .4em;border-radius:10px;white-space:nowrap;">
      <i class="bi ${t.icon}"></i><br>${t.label}
    </a>`).join('');

  const anchor = document.body.firstElementChild;
  document.body.insertBefore(nav, anchor);

  // School name + contact info, fetched once and shown above the tabs if available.
  if (window.SMS_API_URL && orgId) {
    fetch(window.SMS_API_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'publicGetOrgInfo', orgId })
    }).then(r => r.json()).then(resp => {
      if (!resp.ok) return;
      if (resp.schoolName) {
        const label = document.createElement('div');
        label.style.cssText = 'max-width:640px;margin:0 auto 0;text-align:center;color:#fff;opacity:.9;font-size:.85rem;font-weight:700;';
        label.textContent = resp.schoolName;
        document.body.insertBefore(label, nav);
      }
      const bits = [resp.schoolPhone, resp.schoolEmail, resp.schoolAddress].filter(Boolean);
      if (bits.length) {
        const contactLine = document.createElement('div');
        contactLine.style.cssText = 'max-width:640px;margin:0 auto .5rem;text-align:center;color:#fff;opacity:.7;font-size:.72rem;';
        contactLine.textContent = bits.join(' · ');
        document.body.insertBefore(contactLine, nav);
      }
    }).catch(()=>{});
  }
}
