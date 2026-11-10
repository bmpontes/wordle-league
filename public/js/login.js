(function () {
  'use strict';
  const alertEl = document.getElementById('auth-alert');
  const forms = { login: document.getElementById('form-login'), register: document.getElementById('form-register') };
  const tabs = { login: document.getElementById('tab-login'), register: document.getElementById('tab-register') };

  function select(which) {
    for (const k of Object.keys(forms)) {
      forms[k].classList.toggle('hidden', k !== which);
      tabs[k].setAttribute('aria-selected', String(k === which));
    }
    UI.showAlert(alertEl);
  }
  tabs.login.addEventListener('click', () => select('login'));
  tabs.register.addEventListener('click', () => select('register'));

  async function withButton(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      UI.showAlert(alertEl, 'error', err.message);
    } finally {
      btn.disabled = false;
    }
  }

  forms.login.addEventListener('submit', (e) => {
    e.preventDefault();
    withButton(forms.login, async () => {
      const { user } = await Api.post('/api/auth/login', {
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value,
      });
      location.replace(user.role === 'admin' ? '/admin' : '/');
    });
  });

  forms.register.addEventListener('submit', (e) => {
    e.preventDefault();
    withButton(forms.register, async () => {
      const pw = document.getElementById('reg-password').value;
      if (pw !== document.getElementById('reg-password2').value) throw new Error('As passwords não coincidem.');
      await Api.post('/api/auth/register', {
        username: document.getElementById('reg-username').value,
        displayName: document.getElementById('reg-display').value,
        password: pw,
      });
      location.replace('/');
    });
  });

  UI.applyColorblindPreference();
  Api.loadSession()
    .then((s) => {
      if (s.user) location.replace(s.user.role === 'admin' ? '/admin' : '/');
      if (s.registrationEnabled) tabs.register.classList.remove('hidden');
    })
    .catch((err) => UI.showAlert(alertEl, 'error', err.message));
})();
