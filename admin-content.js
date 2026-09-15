function isAdminLoginPage() {
  const url = location.href;
  const html = document.documentElement.innerHTML;

  return (
    /login\.php/i.test(url) ||
    /var\s+page\s*=\s*["']login["']/i.test(html) ||
    !!document.getElementById('logincontainer') ||
    /<title>\s*Login\s*::/i.test(document.title || html) ||
    (!!document.querySelector('input[name="username"]') &&
      !!document.querySelector('input[name="password"]'))
  );
}

function extractVwoTokenFromPage() {
  // Login pages also expose a CSRF vwotoken — that is NOT an admin session.
  if (isAdminLoginPage()) return null;

  const input = document.querySelector('input[name="vwotoken"]');
  if (input && input.value) return input.value;

  if (typeof window.vwotoken === 'string' && window.vwotoken) {
    return window.vwotoken;
  }

  const html = document.documentElement.innerHTML;
  const patterns = [
    /name=["']vwotoken["'][^>]*value=["']([^"']+)["']/i,
    /value=["']([^"']+)["'][^>]*name=["']vwotoken["']/i,
    /vwotoken['"]?\s*[:=]\s*['"]([a-f0-9]{32})['"]/i,
    /["']vwotoken["']\s*:\s*["']([a-f0-9]{32})["']/i,
    /vwotoken=([a-f0-9]{32})/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  for (const script of document.scripts) {
    for (const pattern of patterns) {
      const match = script.textContent.match(pattern);
      if (match) return match[1];
    }
  }

  return null;
}

function cacheVwoToken() {
  if (isAdminLoginPage()) {
    chrome.storage.local.remove(['vwoAdminToken', 'vwoAdminTokenAt']);
    return null;
  }

  const token = extractVwoTokenFromPage();
  if (token) {
    chrome.storage.local.set({
      vwoAdminToken: token,
      vwoAdminTokenAt: Date.now()
    });
  }
  return token;
}

cacheVwoToken();

const observer = new MutationObserver(() => cacheVwoToken());
observer.observe(document.documentElement, { childList: true, subtree: true });

// Auto-refresh every 15 minutes (same rule as testapp).
// Background tab → refresh immediately.
// Visible tab → ask; if no response for 30s, refresh automatically.
let refreshPromptTimer = null;

function dismissRefreshPrompt() {
  if (refreshPromptTimer) {
    clearInterval(refreshPromptTimer);
    refreshPromptTimer = null;
  }
  const el = document.getElementById('vwo-refresh-prompt');
  if (el) el.remove();
}

function showRefreshPrompt() {
  if (document.getElementById('vwo-refresh-prompt')) return;

  let remaining = 30;
  const banner = document.createElement('div');
  banner.id = 'vwo-refresh-prompt';
  banner.style.cssText = [
    'position:fixed',
    'top:16px',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:2147483646',
    'display:flex',
    'align-items:center',
    'gap:12px',
    'padding:12px 16px',
    'background:#1e1e2e',
    'color:#cdd6f4',
    'border-radius:10px',
    'box-shadow:0 8px 28px rgba(0,0,0,.28)',
    'font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
  ].join(';');

  const text = document.createElement('span');
  text.textContent = 'Page refresh due. Refreshing in 30s…';

  const refreshBtn = document.createElement('button');
  refreshBtn.textContent = 'Refresh now';
  refreshBtn.style.cssText = 'border:none;border-radius:6px;padding:7px 12px;background:#2196F3;color:#fff;font-weight:600;cursor:pointer';

  const laterBtn = document.createElement('button');
  laterBtn.textContent = 'Later';
  laterBtn.style.cssText = 'border:1px solid #555;border-radius:6px;padding:7px 12px;background:transparent;color:#cdd6f4;cursor:pointer';

  refreshBtn.addEventListener('click', () => {
    dismissRefreshPrompt();
    location.reload();
  });
  laterBtn.addEventListener('click', () => {
    dismissRefreshPrompt();
  });

  banner.appendChild(text);
  banner.appendChild(refreshBtn);
  banner.appendChild(laterBtn);
  document.documentElement.appendChild(banner);

  refreshPromptTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      dismissRefreshPrompt();
      location.reload();
      return;
    }
    text.textContent = `Page refresh due. Refreshing in ${remaining}s…`;
  }, 1000);
}

function refreshPageIfAllowed() {
  if (document.visibilityState === 'visible') {
    showRefreshPrompt();
    return;
  }
  location.reload();
}

setInterval(refreshPageIfAllowed, 15 * 60 * 1000);

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'extractVwoToken') {
    sendResponse({ token: cacheVwoToken(), isLoginPage: isAdminLoginPage() });
    return false;
  }
});
