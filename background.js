const VWO_ADMIN_BASE = 'https://v2.visualwebsiteoptimizer.com';
const TOKEN_MAX_AGE_MS = 30 * 60 * 1000;

function extractVwoTokenFromHtml(html) {
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

async function getTokenFromOpenAdminTab() {
  const tabs = await chrome.tabs.query({ url: `${VWO_ADMIN_BASE}/*` });

  for (const tab of tabs) {
    if (!tab.id) continue;

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const input = document.querySelector('input[name="vwotoken"]');
          if (input && input.value) return input.value;

          if (typeof window.vwotoken === 'string' && window.vwotoken) {
            return window.vwotoken;
          }

          const patterns = [
            /name=["']vwotoken["'][^>]*value=["']([^"']+)["']/i,
            /value=["']([^"']+)["'][^>]*name=["']vwotoken["']/i,
            /vwotoken['"]?\s*[:=]\s*['"]([a-f0-9]{32})['"]/i,
            /["']vwotoken["']\s*:\s*["']([a-f0-9]{32})["']/i,
            /vwotoken=([a-f0-9]{32})/i
          ];

          const sources = [document.documentElement.innerHTML];
          for (const script of document.scripts) {
            sources.push(script.textContent);
          }

          for (const source of sources) {
            for (const pattern of patterns) {
              const match = source.match(pattern);
              if (match) return match[1];
            }
          }

          return null;
        }
      });

      const token = results[0] && results[0].result;
      if (token) {
        chrome.storage.local.set({
          vwoAdminToken: token,
          vwoAdminTokenAt: Date.now()
        });
        return token;
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
    }
  });

  const html = await response.text();
  return { response, html };
}

async function getVwoToken(manualToken) {
  if (manualToken) {
    chrome.storage.local.set({
      vwoAdminToken: manualToken,
      vwoAdminTokenAt: Date.now()
    });
    return manualToken;
  }

  const cached = await getCachedToken();
  if (cached) return cached;

  const fromTab = await getTokenFromOpenAdminTab();
  if (fromTab) return fromTab;

  const { response, html } = await fetchAdminPage();
  const token = extractVwoTokenFromHtml(html);

  if (token) {
    chrome.storage.local.set({
      vwoAdminToken: token,
      vwoAdminTokenAt: Date.now()
    });
    return token;
  }

  const looksLikeLogin = /login\.php|sign\s*in|google accounts|gcp-web/i.test(html) || response.url.includes('login');
  throw new Error(
    looksLikeLogin
      ? 'Not logged in to VWO admin. Open https://v2.visualwebsiteoptimizer.com/admin/ in a tab, sign in, then try again.'
      : 'Could not find vwotoken. Open the VWO admin panel in a browser tab (keep it open), then retry.'
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
    chrome.tabs.create({ url: `${VWO_ADMIN_BASE}/admin/` });
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
    const authBase = request.authBaseUrl ||
      (sender.tab && sender.tab.url && sender.tab.url.includes('wingify.com')
        ? 'https://app.wingify.com/'
        : 'https://app.vwo.com/');

    fetch(authBase + 'logout', { credentials: 'include', redirect: 'manual' })
      .catch(() => {})
      .then(() => {
        return fetch(authBase + 'login/sso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: request.email }),
          credentials: 'include'
        });
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('SSO login failed (HTTP ' + response.status + ')');
        }
        return fetch(authBase + 'access?accountId=' + encodeURIComponent(request.accountId), {
          credentials: 'include',
          redirect: 'manual'
        });
      })
      .then(() => {
        sendResponse({ success: true, redirectUrl: authBase + 'access?accountId=' + request.accountId });
      })
      .catch(error => {
        console.error('Error during impersonation exit:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }
});
