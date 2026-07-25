const VWO_ADMIN_BASE = 'https://v2.visualwebsiteoptimizer.com';
const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;

function isLoginPageHtml(html, url) {
  if (!html) return true;
  if (url && /login\.php/i.test(url)) return true;

  return (
    /var\s+page\s*=\s*["']login["']/i.test(html) ||
    /id=["']logincontainer["']/i.test(html) ||
    /<title>\s*Login\s*::/i.test(html) ||
    (/name=["']username["']/i.test(html) && /name=["']password["']/i.test(html)) ||
    /google accounts|gcp-web|Sign in with Google/i.test(html)
  );
}

function extractVwoTokenFromHtml(html) {
  if (isLoginPageHtml(html)) return null;

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

  return null;
}

function clearCachedToken() {
  return chrome.storage.local.remove(['vwoAdminToken', 'vwoAdminTokenAt']);
}

function getCachedToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['vwoAdminToken', 'vwoAdminTokenAt'], (result) => {
      if (!result.vwoAdminToken || !result.vwoAdminTokenAt) {
        resolve(null);
        return;
      }

      if (Date.now() - result.vwoAdminTokenAt > TOKEN_MAX_AGE_MS) {
        resolve(null);
        return;
      }

      resolve(result.vwoAdminToken);
    });
  });
}

function cacheToken(token) {
  chrome.storage.local.set({
    vwoAdminToken: token,
    vwoAdminTokenAt: Date.now()
  });
}

async function getTokenFromOpenAdminTab() {
  const tabs = await chrome.tabs.query({ url: `${VWO_ADMIN_BASE}/*` });

  for (const tab of tabs) {
    if (!tab.id) continue;

    // Skip obvious login tabs
    if (tab.url && /login\.php/i.test(tab.url)) continue;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const html = document.documentElement.innerHTML;
          const url = location.href;
          const isLogin =
            /login\.php/i.test(url) ||
            /var\s+page\s*=\s*["']login["']/i.test(html) ||
            !!document.getElementById('logincontainer') ||
            /<title>\s*Login\s*::/i.test(html) ||
            (!!document.querySelector('input[name="username"]') &&
              !!document.querySelector('input[name="password"]'));

          if (isLogin) return { loggedIn: false, token: null };

          const input = document.querySelector('input[name="vwotoken"]');
          if (input && input.value) return { loggedIn: true, token: input.value };

          if (typeof window.vwotoken === 'string' && window.vwotoken) {
            return { loggedIn: true, token: window.vwotoken };
          }

          const patterns = [
            /name=["']vwotoken["'][^>]*value=["']([^"']+)["']/i,
            /value=["']([^"']+)["'][^>]*name=["']vwotoken["']/i,
            /vwotoken['"]?\s*[:=]\s*['"]([a-f0-9]{32})['"]/i,
            /["']vwotoken["']\s*:\s*["']([a-f0-9]{32})["']/i,
            /vwotoken=([a-f0-9]{32})/i
          ];

          const sources = [html];
          for (const script of document.scripts) {
            sources.push(script.textContent);
          }

          for (const source of sources) {
            for (const pattern of patterns) {
              const match = source.match(pattern);
              if (match) return { loggedIn: true, token: match[1] };
            }
          }

          return { loggedIn: false, token: null };
        }
      });

      const result = results[0] && results[0].result;
      if (result && result.loggedIn && result.token) {
        cacheToken(result.token);
        return result.token;
      }
    } catch (error) {
      console.warn('Could not read vwotoken from tab', tab.id, error.message);
    }
  }

  return null;
}

async function fetchAdminPage() {
  const response = await fetch(`${VWO_ADMIN_BASE}/admin/`, {
    credentials: 'include',
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    redirect: 'follow'
  });

  const html = await response.text();
  return { response, html };
}

async function getVwoToken(manualToken) {
  if (manualToken) {
    cacheToken(manualToken);
    return manualToken;
  }

  // Prefer a live check against /admin/ so a cached login-page token can't fool us
  const { response, html } = await fetchAdminPage();
  const finalUrl = response.url || '';

  if (isLoginPageHtml(html, finalUrl)) {
    await clearCachedToken();
    throw new Error(
      'Not logged in to VWO admin. Click Login to Admin, sign in with your credentials, then click Refresh.'
    );
  }

  const token = extractVwoTokenFromHtml(html);
  if (token) {
    cacheToken(token);
    return token;
  }

  // Fall back to an already-open authenticated admin tab
  const fromTab = await getTokenFromOpenAdminTab();
  if (fromTab) return fromTab;

  const cached = await getCachedToken();
  if (cached) return cached;

  throw new Error(
    'Could not find vwotoken. Open the VWO admin panel in a browser tab after signing in, then retry.'
  );
}

async function grantImpersonationPermission(data) {
  const vwotoken = await getVwoToken(data.vwoToken);

  const body = new URLSearchParams({
    vwotoken,
    action: 'grant_impersonation_permission',
    'data[account_id]': String(data.accountId),
    'data[user_id]': data.userId ? String(data.userId) : 'NaN',
    'data[impersonation_permission_id]': String(data.permissionId ?? '0'),
    'data[validity]': String(data.validity),
    'data[reason]': String(data.reason),
    'data[impersonator_email_id]': String(data.impersonatorEmailId)
  });

  const response = await fetch(`${VWO_ADMIN_BASE}/admin/actions.php`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Accept': '*/*',
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': VWO_ADMIN_BASE,
      'Referer': `${VWO_ADMIN_BASE}/admin/`
    },
    body: body.toString()
  });

  const text = await response.text();
  let parsed = null;

  try {
    parsed = JSON.parse(text);
  } catch (_) {
  }

  return {
    ok: response.ok,
    status: response.status,
    text,
    parsed
  };
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === 'executeScript') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      function: () => ({ accountId: document.title })
    }).then(result => {
      sendResponse({ accountId: result[0].result.accountId });
    }).catch(error => {
      console.error('Script execution failed:', error.message);
      sendResponse({ error: error.message });
    });
    return true;
  }

  if (request.action === 'openAdminLogin') {
    chrome.tabs.create({
      url: `${VWO_ADMIN_BASE}/login.php#account:~:text=Grant%20Impersonation%20Permission`
    });
    sendResponse({ success: true });
    return false;
  }

  if (request.action === 'checkAdminSession') {
    getVwoToken(request.manualToken)
      .then(token => sendResponse({ success: true, hasToken: true, tokenPreview: token.slice(0, 8) + '…' }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'grantImpersonationPermission') {
    grantImpersonationPermission(request.data)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exitImpersonate') {
    // Prefer /access switch — logout + /login/sso commonly returns 401 after session clear
    const authBase = request.authBaseUrl ||
      (sender.tab && sender.tab.url && sender.tab.url.includes('wingify.com')
        ? 'https://app.wingify.com/'
        : 'https://app.vwo.com/');

    const redirectUrl = authBase + 'access?accountId=' + encodeURIComponent(request.accountId);
    sendResponse({ success: true, redirectUrl });
    return false;
  }
});
