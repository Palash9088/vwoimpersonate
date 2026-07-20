function extractVwoTokenFromPage() {
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

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'extractVwoToken') {
    sendResponse({ token: cacheVwoToken() });
    return false;
  }
});
