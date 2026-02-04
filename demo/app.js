/**
 * Demo app – même origine que l’API.
 * Option B: accessToken en localStorage (persiste au refresh), refresh token en cookie HttpOnly.
 * Les appels login/refresh utilisent credentials: 'include' pour envoyer/recevoir le cookie.
 * En cas de 401 sur une route protégée, on appelle /auth/refresh puis on retry une fois.
 */

const LOG_ID = 'log';

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

  const res = await fetch(url, { ...options, headers, credentials: 'include' });

  if (res.status === 401 && !retried) {
    const refreshRes = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
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
    const res = await fetch('/auth/register', {
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
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) {
    log('Login: email et password requis', true);
    return;
  }
  try {
    const res = await fetch('/auth/login', {
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

async function createCheckoutSession() {
  const amount = parseInt(document.getElementById('checkout-amount').value, 10);
  const currency = document.getElementById('checkout-currency').value.trim().toLowerCase() || 'eur';
  if (!amount || amount < 1) {
    log('Checkout: amount (cents) requis et > 0', true);
    return;
  }
  try {
    const res = await fetchWithAuth('/payments/checkout-session', {
      method: 'POST',
      body: JSON.stringify({ amount, currency }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.checkoutUrl) {
      log(`Checkout OK: ${data.orderId} -> redirection`);
      window.location.href = data.checkoutUrl;
    } else {
      log(`Checkout ${res.status}: ${data.error || res.statusText}`, true);
    }
  } catch (e) {
    log(`Checkout error: ${e.message}`, true);
  }
}

document.getElementById('form-register').addEventListener('submit', (e) => {
  e.preventDefault();
  register();
});
document.getElementById('form-login').addEventListener('submit', (e) => {
  e.preventDefault();
  login();
});
document.getElementById('btn-me').addEventListener('click', fetchMe);
document.getElementById('form-checkout').addEventListener('submit', (e) => {
  e.preventDefault();
  createCheckoutSession();
});
