function buildTestappLoginUrl(taNo) {
  return `https://vwotestapp${taNo}.wingify.com/#/login`;
}

function buildV2AdminUrl(taNo) {
  return `https://vwotestapp${taNo}-v2admin.vwo.com/login.php#account`;
}

function closeModalTab() {
  const params = new URLSearchParams(window.location.search);
  const returnUrl = params.get('returnUrl');

  // Prefer restoring the exact page we came from
  if (returnUrl) {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id != null) {
        chrome.tabs.update(tab.id, { url: returnUrl });
        return;
      }
      window.location.href = returnUrl;
    });
    return;
  }

  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  chrome.tabs.getCurrent((tab) => {
    if (tab && tab.id != null) chrome.tabs.update(tab.id, { url: 'chrome://newtab/' });
  });
}

function navigateCurrentTab(url) {
  chrome.tabs.getCurrent((tab) => {
    if (tab && tab.id != null) {
      chrome.tabs.update(tab.id, { url });
      return;
    }
    chrome.tabs.create({ url }, () => closeModalTab());
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const taInput = document.getElementById('taNoInput');
  const preview = document.getElementById('taPreview');
  const v2Preview = document.getElementById('v2Preview');
  const errorEl = document.getElementById('errorMessage');
  const openBtn = document.getElementById('openTestappButton');
  const openV2Btn = document.getElementById('openV2AdminButton');

  function refreshPreview() {
    const taNo = taInput.value.trim();
    if (/^\d+$/.test(taNo)) {
      preview.textContent = buildTestappLoginUrl(taNo);
      v2Preview.textContent = buildV2AdminUrl(taNo);
    } else {
      preview.textContent = 'https://vwotestapp{taNo}.wingify.com/#/login';
      v2Preview.textContent = 'https://vwotestapp{taNo}-v2admin.vwo.com/login.php#account';
    }
  }

  function openEnv(kind) {
    const taNo = taInput.value.trim();
    errorEl.textContent = '';
    if (!/^\d+$/.test(taNo)) {
      errorEl.textContent = 'Enter a valid TA number (e.g. 8).';
      taInput.focus();
      return;
    }
    chrome.storage.local.set({ lastTaNo: taNo });
    navigateCurrentTab(kind === 'v2admin' ? buildV2AdminUrl(taNo) : buildTestappLoginUrl(taNo));
  }

  chrome.storage.local.get(['lastTaNo'], (result) => {
    if (result.lastTaNo) taInput.value = result.lastTaNo;
    refreshPreview();
  });

  taInput.addEventListener('input', refreshPreview);
  taInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      openEnv(event.shiftKey ? 'v2admin' : 'testapp');
    }
  });
  openBtn.addEventListener('click', () => openEnv('testapp'));
  openV2Btn.addEventListener('click', () => openEnv('v2admin'));

  document.querySelectorAll('.vwo-tablink').forEach((btn) => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.vwo-tablink').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.vwo-tab-content').forEach((t) => t.classList.remove('active'));
      this.classList.add('active');
      document.getElementById(this.dataset.tab + '-tab').classList.add('active');
    });
  });

  document.getElementById('closeBtn').addEventListener('click', closeModalTab);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModalTab();
  });

  document.getElementById('openAppBtn').addEventListener('click', () => {
    navigateCurrentTab('https://app.vwo.com/');
  });
});
