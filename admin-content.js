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

// Auto-refresh every 15 minutes (same rule as testapp)
setInterval(() => location.reload(), 15 * 60 * 1000);

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'extractVwoToken') {
    sendResponse({ token: cacheVwoToken(), isLoginPage: isAdminLoginPage() });
    return false;
  }
});
