/*******************************************************************
 * PASSWORD SHOW/HIDE TOGGLE — include on any page with a password field:
 *   <script src="pw-toggle.js"></script>
 * Requires Bootstrap 5 + Bootstrap Icons (already loaded on every page that
 * has a password field in this app). Automatically finds every
 * input[type="password"] already on the page, AND any added later (e.g. a
 * password field inside a modal built dynamically, like users.html's Edit
 * User form) via a MutationObserver — no per-page wiring needed beyond the
 * one script tag.
 *******************************************************************/
(function () {
  function wrap(input) {
    if (input.dataset.pwToggled || !input.parentNode) return;
    input.dataset.pwToggled = '1';

    const wrapper = document.createElement('div');
    wrapper.className = 'input-group';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-outline-secondary';
    btn.tabIndex = -1; // keep Tab order moving through the form, not into this button
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = '<i class="bi bi-eye"></i>';
    wrapper.appendChild(btn);

    btn.addEventListener('click', () => {
      const nowShowing = input.type === 'text';
      input.type = nowShowing ? 'password' : 'text';
      btn.querySelector('i').className = nowShowing ? 'bi bi-eye' : 'bi bi-eye-slash';
      btn.setAttribute('aria-label', nowShowing ? 'Show password' : 'Hide password');
    });
  }

  function scan(root) {
    (root || document).querySelectorAll('input[type="password"]').forEach(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }

  new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes && m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.matches && node.matches('input[type="password"]')) wrap(node);
        if (node.querySelectorAll) scan(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.smsPwToggle = { scan };
})();
