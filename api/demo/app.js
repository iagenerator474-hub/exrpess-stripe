/**
 * Demo app – même origine que l’API.
 * Option B: accessToken en localStorage (persiste au refresh), refresh token en cookie HttpOnly.
 * Les appels login/refresh utilisent credentials: 'include' pour envoyer/recevoir le cookie.
 * En cas de 401 sur une route protégée, on appelle /auth/refresh puis on retry une fois.
 */

const LOG_ID = 'log';
// Same origin as the page (e.g. http://localhost:3000 when served from /demo)
var API_BASE = typeof window !== 'undefined' && window.location ? window.location.origin : '';
if (API_BASE && !/^https?:/.test(API_BASE)) {
  API_BASE = ''; // file:// or other; will show error when calling API
}

function getAccessToken() {
  return localStorage.getItem('accessToken') || '';
}

function setAccessToken(token) {
  if (token) localStorage.setItem('accessToken', token);
  else localStorage.removeItem('accessToken');
}

function log(message, isError = false) {
  const el = document.getElementById(LOG_ID);
  if (!el) return;
  const line = document.createElement('div');
  line.className = isError ? 'log-error' : 'log-line';
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/**
 * Appel fetch avec Authorization si token. Sur 401, tente /auth/refresh (cookie) puis retry une fois.
 */
async function fetchWithAuth(url, options = {}, retried = false) {
  const token = getAccessToken();
  const headers = { ...options.headers, 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + url, { ...options, headers, credentials: 'include' });

  if (res.status === 401 && !retried) {
    const refreshRes = await fetch(API_BASE + '/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      const data = await refreshRes.json();
      if (data.accessToken) {
        setAccessToken(data.accessToken);
        return fetchWithAuth(url, options, true);
      }
    }
  }

  return res;
}

async function register() {
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  if (!email || !password) {
    log('Register: email et password requis', true);
    return;
  }
  try {
    const res = await fetch(API_BASE + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      log(`Register OK: ${data.user?.email || email}`);
    } else {
      log(`Register ${res.status}: ${data.error || res.statusText}`, true);
    }
  } catch (e) {
    log(`Register error: ${e.message}`, true);
  }
}

async function login() {
  const emailEl = document.getElementById('login-email');
  const passwordEl = document.getElementById('login-password');
  if (!emailEl || !passwordEl) {
    log('Login: champs introuvables', true);
    return;
  }
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  if (!email || !password) {
    log('Login: email et password requis', true);
    return;
  }
  log('Login en cours...');
  try {
    const res = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (data.accessToken) setAccessToken(data.accessToken);
      log(`Login OK: ${data.user?.email || email}`);
    } else {
      log(`Login ${res.status}: ${data.error || res.statusText}`, true);
    }
  } catch (e) {
    log(`Login error: ${e.message}`, true);
  }
}

async function fetchMe() {
  try {
    const res = await fetchWithAuth('/auth/me');
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      log('Me: ' + JSON.stringify(data.user || data));
    } else {
      log(`Me ${res.status}: ${data.error || res.statusText}`, true);
    }
  } catch (e) {
    log(`Me error: ${e.message}`, true);
  }
}

async function loadProducts() {
  const select = document.getElementById('checkout-product');
  if (!select) return;
  try {
    const res = await fetch(API_BASE + '/products');
    const products = await res.json().catch(() => []);
    if (!res.ok || !Array.isArray(products)) {
      select.innerHTML = '<option value="">Aucun produit</option>';
      return;
    }
    select.innerHTML = products.map(function (p) {
      return '<option value="' + p.id + '">' + (p.name || p.id) + ' – ' + (p.amountCents / 100).toFixed(2) + ' ' + (p.currency || 'eur') + '</option>';
    }).join('');
  } catch (e) {
    select.innerHTML = '<option value="">Erreur chargement</option>';
  }
}

async function createCheckoutSession() {
  const productEl = document.getElementById('checkout-product');
  if (!productEl) {
    log('Checkout: select produit introuvable', true);
    return;
  }
  const productId = (productEl.value && productEl.value.trim()) || '';
  if (!productId) {
    log('Checkout: choisir un produit', true);
    return;
  }
  log('Création session checkout...');
  try {
    const res = await fetchWithAuth('/payments/checkout-session', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.checkoutUrl) {
      log('Checkout OK: ' + data.orderId + ' -> redirection');
      window.location.href = data.checkoutUrl;
    } else {
      log('Checkout ' + res.status + ': ' + (data.error || res.statusText), true);
    }
  } catch (e) {
    log('Checkout error: ' + e.message, true);
  }
}

function init() {
  const formRegister = document.getElementById('form-register');
  const formLogin = document.getElementById('form-login');
  const btnMe = document.getElementById('btn-me');
  const formCheckout = document.getElementById('form-checkout');

  if (!formLogin) {
    console.error('Demo: form-login not found');
    return;
  }

  if (formRegister) {
    formRegister.addEventListener('submit', function (e) {
      e.preventDefault();
      register();
    });
  }
  formLogin.addEventListener('submit', function (e) {
    e.preventDefault();
    login();
  });
  if (btnMe) {
    btnMe.addEventListener('click', fetchMe);
  }
  if (formCheckout) {
    formCheckout.addEventListener('submit', function (e) {
      e.preventDefault();
      createCheckoutSession();
    });
  }
  loadProducts();
  if (!API_BASE) {
    log('Ouvrez cette page via http://localhost:3000/demo (pas en ouvrant le fichier directement).', true);
  } else {
    log('Demo prête. Utilisez Login (demo@example.com / DemoPassword12) ou Payer.');
  }
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
} catch (err) {
  console.error('Demo init error:', err);
  if (typeof log === 'function') log('Erreur chargement demo: ' + err.message, true);
}
