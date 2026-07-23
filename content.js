// Returns the base URL of the current domain (works on *.vwo.com and *.wingify.com)
// e.g. https://app.wingify.com/ or https://vwotestapp12.vwo.com/
function getVwoBaseUrl() {
  const href = window.location.href;
  const dotComIdx = href.indexOf('.com/');
  if (dotComIdx !== -1) {
    return href.substring(0, dotComIdx + 5); // include ".com/"
  }
  return 'https://app.vwo.com/'; // fallback
}

// Returns the auth base URL for logout/SSO — always uses the main app domain,
// not a testapp subdomain.
function getAuthBaseUrl() {
  const host = window.location.hostname;
  if (host.endsWith('wingify.com')) return 'https://app.wingify.com/';
  return 'https://app.vwo.com/';
}

let VWoImpLoginData = {
  featureData: {},
  createImpersonateLoader: function () {
    // Create a container for our shadow DOM
    const loaderContainer = document.createElement('div');
    loaderContainer.id = 'vwo-impersonate-loader-container';
    document.body.appendChild(loaderContainer);

    // Create a shadow DOM
    const shadow = loaderContainer.attachShadow({ mode: 'closed' });

    // Create the loader HTML
    const loaderHTML = `
        <div class="loader" style="display:none;">
          <div class="loader-content">
            <div class="spinner"></div>
            <p>Exiting impersonation...</p>
          </div>
        </div>
      `;

    // Create the loader CSS
    const loaderCSS = `
        .loader {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 9999;
        }
        .loader-content {
          background-color: white;
          padding: 20px;
          border-radius: 5px;
          text-align: center;
        }
        .spinner {
          border: 4px solid #f3f3f3;
          border-top: 4px solid #3498db;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 0 auto 10px;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;

    // Add the HTML and CSS to the shadow DOM
    const styleElement = document.createElement('style');
    styleElement.textContent = loaderCSS;
    shadow.appendChild(styleElement);
    
    // Add the HTML content
    shadow.innerHTML += loaderHTML;

    // Function to show the loader
    function showLoader() {
      shadow.querySelector('.loader').style.display = 'flex';
    }

    // Function to hide the loader
    function hideLoader() {
      shadow.querySelector('.loader').style.display = 'none';
    }

    return { showLoader, hideLoader };
  },
  exitImpersonate: function () {
    const impersonateLoader = VWoImpLoginData.createImpersonateLoader();
    impersonateLoader.showLoader(); // Show the loader when starting the process

    chrome.storage.local.get(['originalAccountId', 'originalEmail'], function (result) {
      const accountId = result.originalAccountId;
      const email = result.originalEmail;

      if (!accountId || !email) {
        console.error('Account ID or email not found. Please set up impersonation settings.');
        impersonateLoader.hideLoader(); // Hide loader if there's an error
        
        // Display a more helpful message with a link to the settings
        VWoImpLoginData.displayErrorMessage('Configuration Required', 
          'Please set up your original account credentials in the extension settings.\nClick the extension icon in the toolbar and enter your account ID and email.');
        
        return;
      }

      const authBase = getAuthBaseUrl();
      const onAuthDomain = getVwoBaseUrl() === authBase;

      // On testapp/subdomains, delegate to background — cross-origin SSO won't set cookies from content script
      if (!onAuthDomain && isExtensionContextValid()) {
        chrome.runtime.sendMessage({
          action: 'exitImpersonate',
          email,
          accountId,
          authBaseUrl: authBase
        }, function (response) {
          if (response && response.success && response.redirectUrl) {
            window.location.href = response.redirectUrl;
          } else {
            impersonateLoader.hideLoader();
            VWoImpLoginData.displayErrorMessage(
              'Exit Impersonation Failed',
              (response && response.error) || 'Could not complete SSO. Please try again.'
            );
          }
        });
        return;
      }

      // Logout first, then SSO regardless of outcome
      fetch(getAuthBaseUrl() + 'logout', {
        method: 'GET',
        credentials: 'include',
        redirect: 'manual'   // don't follow cross-origin redirects
      })
        .catch(() => {})     // ignore network/CORS errors — session may still be cleared
        .finally(() => {
          performSSOLogin(email, accountId, impersonateLoader);
        });
    });
  },
  // Add a function to display error messages
  displayErrorMessage: function(title, message) {
    // Create the error message container
    const errorMessage = document.createElement('div');
    errorMessage.style.position = 'fixed';
    errorMessage.style.top = '50%';
    errorMessage.style.left = '50%';
    errorMessage.style.transform = 'translate(-50%, -50%)';
    errorMessage.style.backgroundColor = 'white';
    errorMessage.style.padding = '20px';
    errorMessage.style.borderRadius = '5px';
    errorMessage.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
    errorMessage.style.zIndex = '10000';
    
    // Create the title element
    const titleEl = document.createElement('h3');
    titleEl.style.marginTop = '0';
    titleEl.style.color = '#f44336';
    titleEl.textContent = title;
    errorMessage.appendChild(titleEl);
    
    // Create the message elements (split by newlines)
    const messageLines = message.split('\n');
    messageLines.forEach(line => {
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      errorMessage.appendChild(paragraph);
    });
    
    // Create the close button
    const closeButton = document.createElement('button');
    closeButton.id = 'closeErrorMessage';
    closeButton.style.backgroundColor = '#f44336';
    closeButton.style.color = 'white';
    closeButton.style.border = 'none';
    closeButton.style.padding = '8px 16px';
    closeButton.style.borderRadius = '4px';
    closeButton.style.cursor = 'pointer';
    closeButton.textContent = 'Close';
    errorMessage.appendChild(closeButton);
    
    // Add to document
    document.body.appendChild(errorMessage);
    
    // Add event listener
    closeButton.addEventListener('click', function() {
      document.body.removeChild(errorMessage);
    });
  },
  // Function to switch the account
  switchAccount: function (accountId) {
    // Update the storage before switching
    updateAccountSettings(accountId);
    
    // Navigate to the account on the current domain (works on testapp and prod)
    const newUrl = `${getVwoBaseUrl()}access?accountId=${accountId}`;
    window.location.href = newUrl;
  },
  impersonateDefaultAccount: function() {
    chrome.storage.local.get(['defaultAccountId'], function(result) {
      if (result.defaultAccountId) {
        VWoImpLoginData.switchAccount(result.defaultAccountId);
      } else {
        console.error('No default account set. Please set a default account in the extension settings.');
        alert('No default account set. Please set a default account in the extension settings.');
      }
    });
  },
  filterProperties: function (obj) {
    const filteredObj = {};
    for (let key in obj) {
      if (key.startsWith('is') || key.startsWith('has')) {
        filteredObj[key] = obj[key];
      }
    }
    return filteredObj;
  },
  convertToUTC: function (timezone, timezoneOffset) {
    try {
      // Get current date in ISO format
      const now = new Date();
      const isoDate = now.toISOString();
      
      // Create a date string in ISO format for the specified timezone
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}T00:00:00.000Z`;
      
      // Create a date object in the specified timezone
      const dateInTimezone = new Date(dateStr);
      
      // Convert to UTC considering the timezone offset
      const utcMillis = dateInTimezone.getTime() - (parseFloat(timezoneOffset) * 60 * 60 * 1000);
      const utcDate = new Date(utcMillis);
      
      // Format the UTC time in ISO format
      const formattedTime = utcDate.toISOString().replace('T', ' ').replace('Z', '');
      
      return formattedTime;
    } catch (error) {
      console.error('Error in convertToUTC:', error);
      return '';
    }
  },

  updateAccountDetails: function (skipImpersonationUI) {
    fetch('/login')
      .then(response => {
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        return response.json();
      })
      .then(data => {
        const accountId = data.accountId;
        const currentAccountName = data.currentAccount ? data.currentAccount.name : 'Unknown';
        
        if (!accountId) {
          console.error("No accountId found in API response");
          return;
        }

        safeStorageAccess(() => {
          chrome.storage.local.get(['defaultAccountId', 'originalAccountId', 'currentAccountId'], function(result) {
            chrome.storage.local.set({ currentAccountId: accountId }, function() {
              if (chrome.runtime.lastError) {
                console.warn('Chrome storage error:', chrome.runtime.lastError);
                return;
              }
              
              VWoImpLoginData.currentAccountId = accountId;

              if (skipImpersonationUI !== true) {
                changeColorOfheader(accountId);
                showImpersonateStatus();
              }
            });
          });
        });
      })
      .catch(error => {
        console.error('Error fetching account details:', error);
      });
  },
  checkFeature: function () {
    const searchInput   = document.getElementById('searchInput');
    const dropdown      = document.getElementById('vwoFeatureDropdown');
    const list          = document.getElementById('vwoFeatureList');
    const selectedDiv   = document.getElementById('selected-value');
    const wrap          = document.getElementById('vwoFeatureWrap');

    if (!searchInput || !dropdown || !list) return;

    // Guard against duplicate initialisation
    if (searchInput.dataset.vwoInited) {
      // Just refresh the list with new data
      renderList(searchInput.value);
      return;
    }
    searchInput.dataset.vwoInited = '1';

    let activeIdx = -1;

    function renderList(term) {
      const keys = Object.keys(VWoImpLoginData.featureData)
        .filter(k => k.toLowerCase().includes((term || '').toLowerCase()));
      list.innerHTML = '';
      activeIdx = -1;

      if (!keys.length) {
        list.innerHTML = '<li class="vwo-ff-empty">No flags found</li>';
        dropdown.classList.add('show');
        return;
      }

      keys.forEach((key, i) => {
        const val = VWoImpLoginData.featureData[key];
        const li  = document.createElement('li');
        li.className   = 'vwo-ff-item';
        li.dataset.key = key;
        li.setAttribute('role', 'option');

        const name  = document.createElement('span');
        name.className   = 'vwo-ff-name';
        name.textContent = key;

        const badge = document.createElement('span');
        badge.className   = 'vwo-ff-badge ' + (val ? 'vwo-ff-on' : 'vwo-ff-off');
        badge.textContent = val ? 'true' : 'false';

        li.appendChild(name);
        li.appendChild(badge);

        li.addEventListener('mousedown', (e) => {
          e.preventDefault(); // keep focus on input
          selectItem(key);
        });
        li.addEventListener('mousemove', () => setActive(i));

        list.appendChild(li);
      });

      dropdown.classList.add('show');
    }

    function setActive(idx) {
      const items = list.querySelectorAll('.vwo-ff-item');
      items.forEach(el => el.classList.remove('vwo-ff-active'));
      activeIdx = idx;
      if (items[idx]) {
        items[idx].classList.add('vwo-ff-active');
        items[idx].scrollIntoView({ block: 'nearest' });
      }
    }

    function selectItem(key) {
      searchInput.value = key;
      const val = VWoImpLoginData.featureData[key];
      selectedDiv.innerHTML =
        `<span class="vwo-ff-result-key">${key}</span>` +
        `<span class="vwo-ff-badge ${val ? 'vwo-ff-on' : 'vwo-ff-off'}">${val ? 'true' : 'false'}</span>`;
      dropdown.classList.remove('show');
      activeIdx = -1;
    }

    searchInput.addEventListener('input', () => renderList(searchInput.value));

    searchInput.addEventListener('focus', () => renderList(searchInput.value));

    searchInput.addEventListener('keydown', (e) => {
      const items = list.querySelectorAll('.vwo-ff-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(activeIdx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(activeIdx - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[activeIdx]) selectItem(items[activeIdx].dataset.key);
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('show');
      }
    });

    document.addEventListener('mousedown', (e) => {
      if (!wrap.contains(e.target)) dropdown.classList.remove('show');
    });
  }
}

// Helper function to safely access chrome.storage
function showExtensionReloadBanner() {
  if (document.getElementById('vwoExtReloadBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'vwoExtReloadBanner';
  banner.style.cssText = `
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    background: #323232; color: #fff; padding: 12px 20px; border-radius: 6px;
    font-size: 13px; font-family: sans-serif; z-index: 2147483647;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 12px;
  `;
  banner.innerHTML = `
    <span>⚠️ VWO Impersonate was updated. Please refresh this page.</span>
    <button onclick="location.reload()" style="
      background:#fff; color:#323232; border:none; border-radius:4px;
      padding:5px 12px; cursor:pointer; font-weight:bold; font-size:12px;
    ">Refresh</button>
  `;
  document.body.appendChild(banner);
}

function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function safeStorageAccess(callback) {
  try {
    if (!isExtensionContextValid()) {
      showExtensionReloadBanner();
      return;
    }
    if (chrome && chrome.storage && chrome.storage.local) {
      callback();
    } else {
      console.warn('Chrome storage is not available');
    }
  } catch (error) {
    if (error.message && error.message.includes('Extension context invalidated')) {
      showExtensionReloadBanner();
    } else {
      console.warn('Storage access error:', error);
    }
  }
}

// Function to check current account status and update UI accordingly
function checkCurrentAccountStatus() {
  fetch('/login')
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    })
    .then(data => {
      const apiAccountId = data.accountId;
      
      if (!apiAccountId) {
        console.error("No accountId found in API response");
        return;
      }

      safeStorageAccess(() => {
        chrome.storage.local.get(['defaultAccountId', 'originalAccountId', 'currentAccountId'], function(result) {
          if (chrome.runtime.lastError) {
            console.warn('Chrome storage error:', chrome.runtime.lastError);
            return;
          }
          
          if (result.currentAccountId !== apiAccountId) {
            chrome.storage.local.set({ currentAccountId: apiAccountId }, function() {
              if (chrome.runtime.lastError) {
                console.warn('Chrome storage error:', chrome.runtime.lastError);
                return;
              }
              
              VWoImpLoginData.currentAccountId = apiAccountId;
              changeColorOfheader(apiAccountId);
              showImpersonateStatus();
              updateImpersonateButtonsVisibility();
            });
          } else {
            VWoImpLoginData.currentAccountId = apiAccountId;
            changeColorOfheader(apiAccountId);
            showImpersonateStatus();
            updateImpersonateButtonsVisibility();
          }
        });
      });
    })
    .catch(error => {
      console.error('Error fetching account data:', error);
    });
}

// Function to update account settings when switching accounts
function updateAccountSettings(accountId) {
  safeStorageAccess(() => {
    chrome.storage.local.set({ currentAccountId: accountId }, function() {
      if (chrome.runtime.lastError) {
        console.warn('Chrome storage error:', chrome.runtime.lastError);
        return;
      }
      // Verify the update
      chrome.storage.local.get(['currentAccountId'], function(result) {
        if (chrome.runtime.lastError) {
          console.warn('Chrome storage error:', chrome.runtime.lastError);
          return;
        }
      });
    });
  });
}

// Function to initialize the extension
function initializeUI() {
  safeStorageAccess(() => {
    chrome.storage.local.get(['defaultAccountId', 'originalAccountId', 'currentAccountId'], function(result) {
      if (chrome.runtime.lastError) {
        console.warn('Chrome storage error:', chrome.runtime.lastError);
        return;
      }
      
      // Make sure we have the values in VWoImpLoginData for backward compatibility
      if (result.defaultAccountId) VWoImpLoginData.defaultAccountId = result.defaultAccountId;
      if (result.originalAccountId) VWoImpLoginData.originalAccountId = result.originalAccountId;
      if (result.currentAccountId) VWoImpLoginData.currentAccountId = result.currentAccountId;
            
      // Create style for hiding elements
      const style = document.createElement('style');
      style.textContent = `
        .hide {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
      
      // Create impersonate button only once - this function checks internally for duplicates
      createImpersonateButton();
      
      // Check current account status
      checkCurrentAccountStatus();
    });
  });
}

// Initialize the extension when loaded
initializeUI();

// Initialize modal on script load
initializeModal();

// Call the check on page load
// checkCurrentAccountStatus(); // This is now called by initializeUI

// Auto-refresh testapp / visualwebsiteoptimizer URLs every 15 minutes
let testappRefreshInterval = null;

function syncTestappRefresh() {
  const href = window.location.href;
  const shouldRefresh = href.includes('testapp') || href.includes('visualwebsiteoptimizer');
  if (shouldRefresh && !testappRefreshInterval) {
    testappRefreshInterval = setInterval(() => location.reload(), 15 * 60 * 1000);
  } else if (!shouldRefresh && testappRefreshInterval) {
    clearInterval(testappRefreshInterval);
    testappRefreshInterval = null;
  }
  // Expose on window so it's visible from the page console
  window.vwoTestappRefreshInterval = testappRefreshInterval;
}

syncTestappRefresh();

// Set up event listener for URL changes with improved handling for account switching
let lastUrl = window.location.href;
const urlChangeObserver = new MutationObserver(() => {
  if (lastUrl !== window.location.href) {
    const oldUrl = lastUrl;
    lastUrl = window.location.href;

    syncTestappRefresh();

    // If navigating to an access URL, this could be an account switch
    const isAccountSwitch = lastUrl.includes('/access') || 
                          lastUrl.includes('accountId=');
    
    if (isAccountSwitch) {
      // Extract account ID from URL if possible
      const accountIdMatch = lastUrl.match(/accountId=([0-9]+)/);
      if (accountIdMatch && accountIdMatch[1]) {
        updateAccountSettings(accountIdMatch[1]);
      }
      
      // Hide impersonation UI immediately during transition
      hideImpersonationElements();
      
      // For account switches, wait a bit longer before checking status
      setTimeout(checkCurrentAccountStatus, 1500);
    } else {
      // For regular navigation, check after a short delay
      setTimeout(() => {
        showImpersonateStatus();
        updateImpersonateButtonsVisibility();
      }, 500);
    }
  }
});

// Start observing for URL changes
urlChangeObserver.observe(document, { subtree: true, childList: true });

// Function to change the color of the XPath element
function changeColorOfheader(accountId) {
  // Get the account IDs from storage
  chrome.storage.local.get(['defaultAccountId', 'originalAccountId', 'currentAccountId'], function(result) {
    const defaultAccountId = result.defaultAccountId;
    const originalAccountId = result.originalAccountId;
    const currentAccountId = accountId || result.currentAccountId;
    
    // Convert all account IDs to strings for proper comparison
    const currentId = String(currentAccountId || '');
    const defaultId = String(defaultAccountId || '');
    const originalId = String(originalAccountId || '');
    
    // Check if we're actually impersonating another account
    const isImpersonating = currentId && 
                           currentId !== defaultId && 
                           currentId !== originalId &&
                           defaultId !== "undefined" && 
                           originalId !== "undefined" &&
                           currentId !== "undefined" &&
                           defaultId !== "" &&
                           originalId !== "";
    
    // Reset header color immediately if we can find it
    let header = document.querySelector("#main-page .header-main");
    if (header) {
      if (isImpersonating) {
        header.style.backgroundColor = '#eeeff1';
      } else {
        header.style.removeProperty('background-color');
      }
    }
    
    // Also set up a MutationObserver to handle cases where the header isn't in the DOM yet
    var observer = new MutationObserver(function(mutationsList, observer) {
      let header = document.querySelector("#main-page .header-main");
      if(header){
        if (isImpersonating) {
          header.style.backgroundColor = '#eeeff1';
        } else {
          header.style.removeProperty('background-color');
        }
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

// Function to show the impersonation status
function showImpersonateStatus() {
  hideImpersonationElements();
  
  chrome.storage.local.get(['defaultAccountId', 'originalAccountId', 'currentAccountId'], function(result) {
    fetch('/login')
      .then(response => response.json())
      .then(data => {
        const apiAccountId = String(data.accountId || '');
        const storedCurrentId = String(result.currentAccountId || '');
        const defaultId = String(result.defaultAccountId || '');
        const originalId = String(result.originalAccountId || '');

        const matchesDefault = apiAccountId === defaultId && defaultId !== '';
        const matchesOriginal = apiAccountId === originalId && originalId !== '';
        
        if (!matchesDefault && !matchesOriginal) {
          showImpersonationElements();
          
          const nameElement = document.querySelector('.impersonated-account-name');
          if (nameElement && data.currentAccount) {
            nameElement.innerText = data.currentAccount.name || 'Unknown Account';
          }
        } else {
          hideImpersonationElements();
        }
        
        changeColorOfheader(apiAccountId);
      })
      .catch(err => console.error('Error fetching account details:', err));
  });
}

// Inject HTML for the side dock
const floatingButtonHTML = `
<div id="floatingButtonContainer">
  <div id="vwoImpSideDock">
    <div id="vwoImpTabHandle" title="VWO Impersonate — click to expand">
      <span id="vwoImpTabDot"></span>
      <span id="vwoImpTabLabel">VWO</span>
    </div>
    <div id="vwoImpPanel">
      <button id="floatingButton">Debugger (⌘⇧E)</button>
      <div id="floatingImpersonatedDisplay" class="floatingImpersonatedDisplayBar hide">
        <p>Impersonated</p>
      </div>
    </div>
  </div>
</div>
`;

document.body.insertAdjacentHTML('beforeend', floatingButtonHTML);

// Vertical drag for the side dock
(function initDockDrag() {
  const container = document.getElementById('floatingButtonContainer');
  const handle    = document.getElementById('vwoImpTabHandle');

  // Restore saved position
  safeStorageAccess(() => {
    chrome.storage.local.get('vwoDockTopPct', function (r) {
      if (r.vwoDockTopPct !== undefined) {
        container.style.top = r.vwoDockTopPct + '%';
      }
    });
  });

  let startY = 0;
  let startTop = 0;
  let dragged = false;

  handle.addEventListener('mousedown', function (e) {
    // Only drag on left-button, ignore if a click on the panel is intended
    if (e.button !== 0) return;
    startY   = e.clientY;
    startTop = container.getBoundingClientRect().top;
    dragged  = false;

    container.classList.add('vwo-dragging');
    handle.classList.add('vwo-grabbing');

    function onMouseMove(e) {
      const delta = e.clientY - startY;
      if (Math.abs(delta) > 3) dragged = true;
      const newTop = Math.min(
        window.innerHeight - container.offsetHeight,
        Math.max(0, startTop + delta)
      );
      container.style.top = newTop + 'px';
    }

    function onMouseUp() {
      container.classList.remove('vwo-dragging');
      handle.classList.remove('vwo-grabbing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);

      if (dragged) {
        // Convert px position to % so it survives viewport resize
        const topPct = (container.getBoundingClientRect().top / window.innerHeight) * 100;
        container.style.top = topPct + '%';
        safeStorageAccess(() => {
          chrome.storage.local.set({ vwoDockTopPct: topPct });
        });
      }
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup',   onMouseUp);
  });

  // Toggle panel on click; suppress toggle after a drag reposition
  handle.addEventListener('click', function (e) {
    if (dragged) {
      e.stopImmediatePropagation();
      dragged = false;
      return;
    }
    document.getElementById('vwoImpSideDock').classList.toggle('vwo-open');
  }, true);

  // Close panel when clicking outside the dock
  document.addEventListener('click', function (e) {
    const dock = document.getElementById('vwoImpSideDock');
    if (!dock || !dock.classList.contains('vwo-open')) return;
    if (dock.contains(e.target)) return;
    dock.classList.remove('vwo-open');
  });
})();

// Inject CSS for the side dock
const floatingButtonCSS = `
#floatingButtonContainer {
  position: fixed;
  right: 0;
  top: 50%;
  z-index: 2147483646;
  pointer-events: none;
  transition: top 0.1s ease;
}

#floatingButtonContainer.vwo-dragging {
  transition: none;
}

#vwoImpTabHandle {
  cursor: grab;
}

#vwoImpTabHandle.vwo-grabbing {
  cursor: grabbing;
}

#vwoImpSideDock {
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  pointer-events: auto;
}

#vwoImpTabHandle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: #4429A2;
  color: #fff;
  padding: 14px 7px;
  font-size: 11px;
  font-weight: bold;
  letter-spacing: 0.5px;
  border-radius: 8px 0 0 8px;
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.2);
  user-select: none;
}

#vwoImpTabLabel {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

#vwoImpTabDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #9e9e9e;
  flex-shrink: 0;
}

#vwoImpSideDock.vwo-impersonating #vwoImpTabDot {
  background: #f44336;
  box-shadow: 0 0 6px #f44336;
}

#vwoImpPanel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: rgba(55, 33, 131, 0.97);
  border-radius: 8px 0 0 8px;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.25);
  transform: translateX(100%);
  opacity: 0;
  transition: transform 0.2s ease, opacity 0.2s ease;
  pointer-events: none;
  min-width: 170px;
}

#vwoImpSideDock.vwo-open #vwoImpPanel {
  transform: translateX(0);
  opacity: 1;
  pointer-events: auto;
}

#floatingButton,
#vwoExitImpersonateBtn,
#vwoDefaultImpersonateBtn {
  width: 100%;
  box-sizing: border-box;
  border: none;
  border-radius: 4px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 12px;
  font-weight: bold;
  margin: 0;
  text-align: center;
}

#floatingButton {
  background-color: #007bff;
  color: #fff;
}

#floatingButton:hover {
  background-color: #0056b3;
}

#vwoExitImpersonateBtn {
  background-color: #f44336;
  color: white;
}

#vwoExitImpersonateBtn:hover {
  background-color: #d32f2f;
}

#vwoDefaultImpersonateBtn {
  background-color: #4CAF50;
  color: white;
}

#vwoDefaultImpersonateBtn:hover {
  background-color: #388e3c;
}

#floatingImpersonatedDisplay {
  background: #fff;
  color: #d32f2f;
  font-weight: bold;
  border-radius: 4px;
  text-align: center;
  padding: 6px 8px;
  border: 1px solid #ffcdd2;
}

#floatingImpersonatedDisplay p {
  margin: 0;
  padding: 0;
  font-size: 13px;
}

.floatingImpersonatedDisplayBar.hide {
  display: none;
}
`;

const styleTag = document.createElement('style');
styleTag.textContent = floatingButtonCSS;
document.head.appendChild(styleTag);

// Function to open the modal
// Read clipboard once and auto-fill account ID input if a valid ID is found.
// Called every time the modal opens — no background polling.
async function readClipboardOnce() {
  const input = document.getElementById('accountIdInput');
  if (!input) return;
  try {
    const permission = await navigator.permissions.query({ name: 'clipboard-read' });
    if (permission.state === 'granted') {
      const text = await navigator.clipboard.readText();
      if (text) {
        const clean = text.replace(/,/g, '').replace(/\s/g, '');
        const match = clean.match(/\d{6,9}/);
        if (match) input.value = match[0];
      }
    }
  } catch (err) {
    // Clipboard API unavailable — silently ignore
  }
}

function openModal() {
  const modal = document.getElementById('vwoImpersonateDebugger');
  if (modal) {
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
  }

  readClipboardOnce();

  // Update account details but ensure impersonation UI is NOT updated
  // Skip updating UI and use a separate fetch to get data for the modal only
  fetch('/login')
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    })
    .then(data => {
      // Just update the modal data fields without touching impersonation UI
      const timeZone = data.currentAccount.timezone;
      const timezoneOffset = data.currentAccount.timezoneOffset;
      const utcTime = VWoImpLoginData.convertToUTC(timeZone, timezoneOffset);
      
      // Only update UI elements in the modal
      const timezoneEl = document.getElementById('timezone');
      const utcTimeEl = document.getElementById('utcTime');
      
      if (timezoneEl) timezoneEl.innerText = `${timeZone} (${timezoneOffset})`;
      if (utcTimeEl) utcTimeEl.innerText = utcTime;

      // Update feature data without affecting impersonation UI
      VWoImpLoginData.featureData = VWoImpLoginData.filterProperties(data.currentAccount);
      
      // Initialize features for search functionality
      VWoImpLoginData.checkFeature();
    })
    .catch(error => {
      console.error('Error fetching account data for modal:', error);
    });
}

// Function to initialize the modal UI
function initializeModal() {
  const modalHTML = `<div id="vwoImpersonateDebugger" class="vwo-modal">
    <div class="vwo-modal-body">
      <div class="vwo-modal-header">
        <div class="vwo-modal-title">
          <span class="vwo-modal-icon">🔧</span>
          <span>VWO Impersonate Debugger</span>
        </div>
        <button class="vwo-close" title="Close (Esc)">&times;</button>
      </div>
      <div class="vwo-tabs">
        <button class="vwo-tablink active" data-tab="debugger">Debugger</button>
        <button class="vwo-tablink" data-tab="login-response">/login Response</button>
        <button class="vwo-tablink" data-tab="converter">Timezone Converter</button>
        <button class="vwo-tablink" data-tab="grant-access">Grant Access</button>
      </div>
      <div class="vwo-modal-content">

        <!-- Debugger Tab -->
        <div id="debugger-tab" class="vwo-tab-content active">
          <div class="vwo-two-col">
            <div class="vwo-panel">
              <div class="vwo-panel-title">Account Details</div>
              <div class="vwo-info-row"><span class="vwo-label">Timezone</span><span id="timezone" class="vwo-value">—</span></div>
              <div class="vwo-info-row"><span class="vwo-label">UTC Time</span><span id="utcTime" class="vwo-value">—</span></div>
              <div class="vwo-panel-title" style="margin-top:16px">Feature Flags</div>
              <div class="vwo-search-wrap" id="vwoFeatureWrap">
                <input type="text" id="searchInput" placeholder="🔍  Search features…" class="vwo-input" autocomplete="off">
                <div class="vwo-dropdown-panel" id="vwoFeatureDropdown">
                  <ul id="vwoFeatureList" role="listbox"></ul>
                </div>
              </div>
              <div id="selected-value" class="vwo-selected-value"></div>
            </div>
            <div class="vwo-panel">
              <div class="vwo-panel-title">Quick Navigation</div>
              <form id="accountIdForm" class="vwo-form">
                <label class="vwo-label">Impersonate Account</label>
                <div class="vwo-input-row">
                  <input type="text" id="accountIdInput" placeholder="VWO Account ID" class="vwo-input" maxlength="9">
                  <button id="submitButton" class="vwo-btn vwo-btn-green">Go</button>
                </div>
              </form>
              <form id="campaignIdForm" class="vwo-form">
                <label class="vwo-label">Switch Campaign</label>
                <div class="vwo-input-row">
                  <input type="text" id="campaignIdInput" placeholder="Campaign ID" class="vwo-input">
                  <button id="campaignSubmitButton" class="vwo-btn vwo-btn-green">Go</button>
                </div>
              </form>
              <p id="errorMessage" class="vwo-error-msg"></p>
            </div>
          </div>
          <div class="vwo-modal-footer">
            <button id="backButton" class="vwo-btn vwo-btn-red">Exit Impersonate</button>
          </div>
        </div>

        <!-- /login Response Tab -->
        <div id="login-response-tab" class="vwo-tab-content">
          <div class="vwo-login-toolbar">
            <button id="vwoRefreshLogin" class="vwo-btn vwo-btn-blue">↻ Refresh</button>
            <button id="vwoCopyLogin" class="vwo-btn vwo-btn-outline">Copy JSON</button>
            <span id="vwoLoginFetchTime" class="vwo-fetch-time"></span>
          </div>
          <pre id="vwoLoginResponse" class="vwo-json-viewer">Loading…</pre>
        </div>

        <!-- Timezone Converter Tab -->
        <div id="converter-tab" class="vwo-tab-content">
          <div class="vwo-converter">
            <div class="vwo-panel-title">Timezone → UTC Converter</div>
            <div class="vwo-form">
              <label class="vwo-label">Timezone</label>
              <select id="timezoneSelect" class="vwo-input">
                <option value="-12">Baker Island (−12:00)</option>
                <option value="-11">Samoa (−11:00)</option>
                <option value="-10">Hawaii (−10:00)</option>
                <option value="-9">Alaska (−9:00)</option>
                <option value="-8">Pacific Time (−8:00)</option>
                <option value="-7">Mountain Time (−7:00)</option>
                <option value="-6">Central Time (−6:00)</option>
                <option value="-5">Eastern Time (−5:00)</option>
                <option value="-4">Atlantic Time (−4:00)</option>
                <option value="-3">Brazil (−3:00)</option>
                <option value="-2">South Georgia (−2:00)</option>
                <option value="-1">Cape Verde (−1:00)</option>
                <option value="0">UTC (0:00)</option>
                <option value="1">Berlin (+1:00)</option>
                <option value="2">Cairo (+2:00)</option>
                <option value="3">Moscow (+3:00)</option>
                <option value="4">Dubai (+4:00)</option>
                <option value="5">Pakistan (+5:00)</option>
                <option value="5.5">India (+5:30)</option>
                <option value="5.75">Nepal (+5:45)</option>
                <option value="6">Bangladesh (+6:00)</option>
                <option value="6.5">Myanmar (+6:30)</option>
                <option value="7">Bangkok (+7:00)</option>
                <option value="8">China (+8:00)</option>
                <option value="9">Tokyo (+9:00)</option>
                <option value="10">Sydney (+10:00)</option>
                <option value="11">Solomon Islands (+11:00)</option>
                <option value="12">New Zealand (+12:00)</option>
                <option value="14">Line Islands (+14:00)</option>
              </select>
            </div>
            <div class="vwo-form">
              <label class="vwo-label">From Date</label>
              <input type="date" id="fromDate" class="vwo-input">
            </div>
            <div class="vwo-form">
              <label class="vwo-label">To Date</label>
              <input type="date" id="toDate" class="vwo-input">
            </div>
            <button id="convertBtn" class="vwo-btn vwo-btn-green" style="width:100%">Convert</button>
            <div class="vwo-converter-result">
              <div id="utcFromTime" class="vwo-result-row">UTC From: <strong>—</strong></div>
              <div id="utcToTime" class="vwo-result-row">UTC To: <strong>—</strong></div>
            </div>
            <div id="luxonStatus" style="display:none;color:#f44336;text-align:center;margin-top:8px">Error during conversion. Please try again.</div>
          </div>
        </div>

        <!-- Grant Access Tab -->
        <div id="grant-access-tab" class="vwo-tab-content">
          <div class="vwo-grant-panel">
            <form id="grantAccessForm" class="vwo-form vwo-grant-form">
              <div class="vwo-form">
                <label class="vwo-label" for="grantImpersonatorEmail">Impersonator Email ID</label>
                <input type="email" id="grantImpersonatorEmail" class="vwo-input" value="palash.soni@wingify.com" placeholder="palash.soni@wingify.com" required>
              </div>
              <div class="vwo-form">
                <label class="vwo-label" for="grantAccountId">Account ID</label>
                <input type="text" id="grantAccountId" class="vwo-input" placeholder="Target account ID" maxlength="9" required>
              </div>
              <div class="vwo-form">
                <label class="vwo-label" for="grantUserId">User ID <span class="vwo-optional">(optional)</span></label>
                <input type="text" id="grantUserId" class="vwo-input" placeholder="Leave blank if unknown">
              </div>
              <div class="vwo-form">
                <label class="vwo-label" for="grantPermissionId">Permission ID</label>
                <select id="grantPermissionId" class="vwo-input" required>
                  <option value="0">Browse</option>
                </select>
              </div>
              <div class="vwo-form">
                <label class="vwo-label" for="grantReason">Reason</label>
                <input type="text" id="grantReason" class="vwo-input" placeholder="e.g. QF-20123" required>
              </div>
              <button type="submit" id="grantAccessBtn" class="vwo-btn vwo-btn-green" style="width:100%">Grant Permission</button>
            </form>
            <p id="grantAccessError" class="vwo-error-msg"></p>
            <pre id="grantAccessResult" class="vwo-json-viewer vwo-grant-result" style="display:none"></pre>
          </div>
        </div>

      </div>
      <div class="vwo-modal-credit">Developed with ❤️ at <strong>Wingify / VWO</strong></div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modalCSS = `
    /* Overlay */
    .vwo-modal {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 2147483640;
      background: rgba(15,15,25,0.55);
      backdrop-filter: blur(3px);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* Dialog box */
    .vwo-modal-body {
      background: #fff;
      border-radius: 12px;
      width: 860px;
      max-width: calc(100vw - 32px);
      max-height: 88vh;
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 64px rgba(0,0,0,0.28);
      overflow: hidden;
    }

    /* Header */
    .vwo-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px;
      background: linear-gradient(135deg, #372183, #5130C1);
      color: #fff;
      flex-shrink: 0;
    }
    .vwo-modal-title {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vwo-modal-icon { font-size: 18px; }
    .vwo-close {
      background: rgba(255,255,255,0.15);
      border: none;
      color: #fff;
      font-size: 20px;
      line-height: 1;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .vwo-close:hover { background: rgba(255,255,255,0.28); }

    /* Tabs */
    .vwo-tabs {
      display: flex;
      background: #f6f6f8;
      border-bottom: 1px solid #e0e0e8;
      flex-shrink: 0;
    }
    .vwo-tablink {
      flex: 1;
      background: none;
      border: none;
      border-bottom: 3px solid transparent;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      color: #666;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
    }
    .vwo-tablink:hover { color: #5130C1; background: #E4DFF6; }
    .vwo-tablink.active {
      color: #4429A2;
      font-weight: 700;
      border-bottom-color: #5130C1;
      background: #fff;
    }

    /* Content area */
    .vwo-modal-content {
      overflow-y: auto;
      flex: 1;
    }
    .vwo-tab-content { display: none; padding: 20px; }
    .vwo-tab-content.active { display: block; }

    /* Two-column layout */
    .vwo-two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    /* Panel */
    .vwo-panel {
      background: #fafafa;
      border: 1px solid #e8e8f0;
      border-radius: 8px;
      padding: 16px;
    }
    .vwo-panel-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      color: #5130C1;
      margin-bottom: 12px;
    }

    /* Info rows */
    .vwo-info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      padding: 5px 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .vwo-info-row:last-child { border-bottom: none; }
    .vwo-label { color: #888; font-size: 12px; }
    .vwo-value { font-weight: 600; color: #333; text-align: right; }

    /* Inputs */
    .vwo-input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #d0d0dc;
      border-radius: 6px;
      font-size: 13px;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s;
    }
    .vwo-input:focus { border-color: #5130C1; box-shadow: 0 0 0 3px rgba(81, 48, 193, 0.12); }

    /* Input + button row */
    .vwo-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .vwo-input-row .vwo-input { flex: 1; min-width: 0; width: 100%; }

    /* Forms */
    .vwo-form {
      margin-top: 14px;
    }
    .vwo-form .vwo-label {
      display: block;
      margin-bottom: 5px;
      font-weight: 600;
      color: #555;
      font-size: 12px;
    }

    /* Buttons */
    .vwo-btn {
      border: none;
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.15s;
    }
    .vwo-btn:hover { opacity: 0.85; }
    .vwo-btn-green { background: #4CAF50; color: #fff; }
    .vwo-btn-red   { background: #f44336; color: #fff; }
    .vwo-btn-blue  { background: #2196F3; color: #fff; }
    .vwo-btn-outline {
      background: #fff;
      color: #555;
      border: 1px solid #ccc;
    }

    /* Feature search */
    .vwo-search-wrap { position: relative; }
    .vwo-dropdown-panel {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #fff;
      border: 1px solid #d0d0dc;
      border-radius: 0 0 6px 6px;
      box-shadow: 0 8px 20px rgba(0,0,0,0.12);
      z-index: 10;
    }
    .vwo-dropdown-panel.show { display: block; }
    #vwoFeatureList {
      list-style: none;
      margin: 0;
      padding: 4px 0;
      max-height: 200px;
      overflow-y: auto;
    }
    .vwo-ff-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 12px;
      cursor: pointer;
      font-size: 12px;
      gap: 8px;
    }
    .vwo-ff-item:hover,
    .vwo-ff-item.vwo-ff-active {
      background: #F6F5FC;
    }
    .vwo-ff-name {
      flex: 1;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .vwo-ff-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 10px;
      flex-shrink: 0;
      letter-spacing: 0.3px;
    }
    .vwo-ff-on  { background: #e6f4ea; color: #2e7d32; }
    .vwo-ff-off { background: #fce8e6; color: #c62828; }
    .vwo-ff-empty {
      padding: 10px 12px;
      font-size: 12px;
      color: #999;
      text-align: center;
    }
    .vwo-selected-value {
      margin-top: 8px;
      font-size: 13px;
      min-height: 22px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .vwo-ff-result-key {
      color: #333;
      font-weight: 600;
    }

    /* Error */
    .vwo-error-msg {
      color: #f44336;
      font-size: 12px;
      margin-top: 6px;
      min-height: 16px;
    }

    /* Footer */
    .vwo-modal-footer {
      padding: 12px 20px;
      border-top: 1px solid #e8e8f0;
      text-align: right;
      margin-top: 16px;
    }

    /* /login Response Tab */
    .vwo-login-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 12px;
    }
    .vwo-fetch-time {
      font-size: 11px;
      color: #999;
      margin-left: auto;
    }
    .vwo-json-viewer {
      background: #1e1e2e;
      color: #cdd6f4;
      border-radius: 8px;
      padding: 16px;
      font-size: 12px;
      line-height: 1.6;
      max-height: 440px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-all;
      margin: 0;
      font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    /* Converter */
    .vwo-converter { max-width: 460px; margin: 0 auto; }
    .vwo-converter-result {
      margin-top: 16px;
      background: #F6F5FC;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .vwo-result-row {
      font-size: 13px;
      color: #555;
      padding: 4px 0;
    }
    .vwo-result-row strong { color: #4429A2; }

    .vwo-modal-credit {
      text-align: center;
      font-size: 11px;
      color: #aaa;
      padding: 8px 0 10px;
      border-top: 1px solid #f0f0f0;
      flex-shrink: 0;
    }
    .vwo-modal-credit strong { color: #4429A2; }

    /* Grant Access tab */
    .vwo-grant-panel { padding: 4px 0; }
    .vwo-grant-note {
      background: #fff8e1;
      border-left: 4px solid #ffc107;
      padding: 10px 12px;
      border-radius: 4px;
      font-size: 13px;
      color: #5d4037;
      margin-bottom: 14px;
      line-height: 1.45;
    }
    .vwo-grant-note code { background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
    .vwo-grant-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
    .vwo-btn-sm { padding: 6px 12px !important; font-size: 12px !important; width: auto !important; }
    .vwo-grant-advanced { margin-bottom: 12px; font-size: 12px; color: #666; }
    .vwo-grant-advanced summary { cursor: pointer; color: #5130C1; font-weight: 600; }
    .vwo-grant-session {
      font-size: 12px;
      margin-bottom: 14px;
      padding: 8px 10px;
      border-radius: 6px;
      background: #f6f6f8;
      color: #555;
    }
    .vwo-grant-session.ok { background: #e8f5e9; color: #2e7d32; }
    .vwo-grant-session.warn { background: #fff3e0; color: #e65100; }
    .vwo-grant-form { margin-top: 4px; }
    .vwo-optional { color: #999; font-weight: 400; font-size: 11px; }
    .vwo-grant-result { margin-top: 12px; max-height: 180px; }
  `;

  const modalStyleTag = document.createElement('style');
  modalStyleTag.textContent = modalCSS;
  document.head.appendChild(modalStyleTag);
  
  closeModal = function () {
    const modal = document.getElementById('vwoImpersonateDebugger');
    if (modal) {
      modal.style.display = 'none';
      document.body.style.overflow = '';
    }
  }

  // Close button
  document.querySelector('.vwo-close').addEventListener('click', closeModal);

  // Tab switching
  document.querySelectorAll('.vwo-tablink').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.vwo-tablink').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.vwo-tab-content').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      const tabId = this.dataset.tab + '-tab';
      document.getElementById(tabId).classList.add('active');
      if (this.dataset.tab === 'login-response') fetchAndShowLoginResponse();
      if (this.dataset.tab === 'grant-access') initGrantAccessTab();
    });
  });

  function initGrantAccessTab(preserveResult) {
    const errorEl = document.getElementById('grantAccessError');
    const resultEl = document.getElementById('grantAccessResult');
    if (!preserveResult) {
      errorEl.textContent = '';
      resultEl.style.display = 'none';
    }

    const emailInput = document.getElementById('grantImpersonatorEmail');
    if (!emailInput.value) {
      emailInput.value = 'palash.soni@wingify.com';
    }

    chrome.storage.local.get(['currentAccountId'], function (result) {
      const accountInput = document.getElementById('grantAccountId');
      if (result.currentAccountId && !accountInput.value) {
        accountInput.value = result.currentAccountId;
      }
    });

    fetch('/login')
      .then(r => r.json())
      .then(data => {
        const accountInput = document.getElementById('grantAccountId');
        if (data.accountId && !accountInput.value) {
          accountInput.value = data.accountId;
        }
      })
      .catch(() => {});
  }

  // /login Response tab logic
  function fetchAndShowLoginResponse() {
    const pre = document.getElementById('vwoLoginResponse');
    const timeEl = document.getElementById('vwoLoginFetchTime');
    pre.textContent = 'Fetching…';
    const start = Date.now();
    fetch('/login')
      .then(r => r.json())
      .then(data => {
        pre.textContent = JSON.stringify(data, null, 2);
        timeEl.textContent = `Fetched in ${Date.now() - start}ms · ${new Date().toLocaleTimeString()}`;
      })
      .catch(err => {
        pre.textContent = 'Error: ' + err.message;
        timeEl.textContent = '';
      });
  }

  document.getElementById('vwoRefreshLogin').addEventListener('click', fetchAndShowLoginResponse);

  document.getElementById('vwoCopyLogin').addEventListener('click', function () {
    const text = document.getElementById('vwoLoginResponse').textContent;
    navigator.clipboard.writeText(text).then(() => {
      this.textContent = 'Copied!';
      setTimeout(() => { this.textContent = 'Copy JSON'; }, 1500);
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      document.getElementById('vwoImpersonateDebugger').style.display = 'none';
    }
  });
  
  // Add submit event listener to the form
  document.getElementById('accountIdForm').addEventListener('submit', function (event) {
    // Prevent the default form submission behavior
    event.preventDefault();

    // Get the account ID input value
    const accountId = document.getElementById('accountIdInput').value;

    // Call the function to switch account
    VWoImpLoginData.switchAccount(accountId);
  });

  // Add clipboard paste functionality to accountIdInput
  const accountIdInput = document.getElementById('accountIdInput');
  
  // Create error message element — appended after the input-row, not inside it
  const errorDiv = document.createElement('div');
  errorDiv.style.color = '#f44336';
  errorDiv.style.fontSize = '12px';
  errorDiv.style.marginTop = '4px';
  errorDiv.style.display = 'none';
  accountIdInput.parentElement.insertAdjacentElement('afterend', errorDiv);
  
  let errorTimeout;
  
  // Function to show error message
  function showError(message) {
    // Clear any existing timeout
    if (errorTimeout) {
      clearTimeout(errorTimeout);
    }
    
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    
    // Set new timeout
    errorTimeout = setTimeout(() => {
      errorDiv.style.display = 'none';
    }, 10000);
  }
  
  // Function to validate and set account ID
  function handleAccountIdPaste(text) {
    // Remove commas and any whitespace
    const cleanText = text.replace(/,/g, '').replace(/\s/g, '');
    
    // Extract 6 to 9 digit numbers from the text
    const matches = cleanText.match(/\d{6,9}/);
    
    if (matches) {
      // Found a valid account ID
      const accountId = matches[0];
      accountIdInput.value = accountId;
      errorDiv.style.display = 'none';
    } else {
      // Check if the text contains letters
      if (/[a-zA-Z]/.test(text)) {
        showError('⚠️ Please paste a numeric account ID, not a string');
      } else {
        showError('⚠️ No valid 6–9 digit account ID found in the pasted text');
      }
    }
  }

  // Trigger clipboard read now that modal is open
  readClipboardOnce();

  // Handle paste event
  accountIdInput.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    handleAccountIdPaste(text);
  });

  // switch to campaign
  function redirectToReport() {
    // Get the campaign ID input value
    const campaignId = document.getElementById('campaignIdInput').value;

    // Build campaign report URL on the current domain
    const url = `${getVwoBaseUrl()}#/test/ab/${campaignId}/report`;

    // Redirect the window to the constructed URL
    window.location.href = url;
  }

  // switch to campaign on form submit
  document.getElementById('campaignIdForm').addEventListener('submit', function (event) {
    event.preventDefault(); // Prevent default form submission behavior
    redirectToReport(); // Call the function to redirect to the report
    document.getElementById('campaignIdForm').reset();
    closeModal();
  });


  // Add click event listener to the back button
  document.getElementById('backButton').addEventListener('click', function () {
    VWoImpLoginData.exitImpersonate();
  });

  // Tab switching is handled above via .vwo-tablink listeners

  // Set current date for the date pickers
  const today = new Date();
  const fromDateInput = document.getElementById('fromDate');
  const toDateInput = document.getElementById('toDate');
  
  if (fromDateInput && toDateInput) {
    const formattedDate = today.toISOString().split('T')[0];
    fromDateInput.value = formattedDate;
    toDateInput.value = formattedDate;
  }

  // Add converter functionality
  document.getElementById('convertBtn').addEventListener('click', convertToUTC);

  document.getElementById('grantAccessForm').addEventListener('submit', function (event) {
    event.preventDefault();

    const errorEl = document.getElementById('grantAccessError');
    const resultEl = document.getElementById('grantAccessResult');
    const submitBtn = document.getElementById('grantAccessBtn');
    errorEl.textContent = '';
    resultEl.style.display = 'none';

    const impersonatorEmailId = document.getElementById('grantImpersonatorEmail').value.trim() || 'palash.soni@wingify.com';
    const accountId = document.getElementById('grantAccountId').value.trim();
    const userId = document.getElementById('grantUserId').value.trim();
    const permissionId = document.getElementById('grantPermissionId').value.trim() || '0';
    const reason = document.getElementById('grantReason').value.trim();
    const validity = '14';

    if (!impersonatorEmailId || !accountId || !reason) {
      errorEl.textContent = 'Please fill in Impersonator Email ID, Account ID, and Reason.';
      return;
    }

    if (!/^\d{6,9}$/.test(accountId)) {
      errorEl.textContent = 'Account ID must be 6–9 digits.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Granting…';

    chrome.runtime.sendMessage({
      action: 'grantImpersonationPermission',
      data: {
        impersonatorEmailId,
        accountId,
        userId,
        permissionId,
        validity,
        reason,
      }
    }, function (response) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Grant Permission';

      if (chrome.runtime.lastError) {
        errorEl.textContent = 'Extension error: ' + chrome.runtime.lastError.message;
        return;
      }

      if (!response || !response.success) {
        errorEl.textContent = (response && response.error) || 'Failed to grant permission.';
        initGrantAccessTab();
        return;
      }

      const { result } = response;
      resultEl.style.display = 'block';

      if (result.parsed) {
        resultEl.textContent = JSON.stringify(result.parsed, null, 2);
        if (result.parsed.success === false || result.parsed.error) {
          errorEl.textContent = result.parsed.error || result.parsed.message || 'Grant request returned an error.';
        }
      } else {
        resultEl.textContent = result.text || '(empty response)';
        if (!result.ok) {
          errorEl.textContent = 'Request failed with HTTP ' + result.status;
        }
      }

      initGrantAccessTab(true);
    });
  });
}

function convertToUTC() {
  try {
    const timezoneOffset = parseFloat(document.getElementById('timezoneSelect').value);
    const fromDateInput = document.getElementById('fromDate').value;
    const toDateInput = document.getElementById('toDate').value;

    if (!fromDateInput || !toDateInput) {
      alert('🚨 Please select both From and To dates. 🚨');
      return;
    }

    // Parse dates using native Date object
    const fromDateObj = new Date(fromDateInput);
    const toDateObj = new Date(toDateInput);

    if (isNaN(fromDateObj.getTime()) || isNaN(toDateObj.getTime())) {
      throw new Error('Invalid date format. Please use YYYY-MM-DD format.');
    }

    // Prevent "To Date" from being before "From Date"
    if (toDateObj < fromDateObj) {
      alert('🚨 To Date cannot be before From Date! 🚨');
      return;
    }

    // Set the time components
    fromDateObj.setHours(0, 0, 0, 0);
    toDateObj.setHours(23, 59, 59, 999);

    // Convert to UTC by subtracting the timezone offset
    const fromUTC = new Date(fromDateObj.getTime() - (timezoneOffset * 60 * 60 * 1000));
    const toUTC = new Date(toDateObj.getTime() - (timezoneOffset * 60 * 60 * 1000));

    // Format and display UTC results
    document.getElementById('utcFromTime').innerHTML = `UTC From: <strong>${formatDateTime(fromUTC)}</strong>`;
    document.getElementById('utcToTime').innerHTML = `UTC To: <strong>${formatDateTime(toUTC)}</strong>`;
    
    document.getElementById('luxonStatus').style.display = 'none';
  } catch (error) {
    console.error('Error converting timezone:', error);
    document.getElementById('luxonStatus').style.display = 'block';
    document.getElementById('luxonStatus').innerHTML = 
      `<p>Error during conversion: ${error.message}. Please try again.</p>`;
  }
}

function formatDateTime(date) {
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Add click event listener to the floating button
document.getElementById('floatingButton').addEventListener('click', function () {
  // Open the modal
  openModal();
});

// Function to handle messages from the background script
if (isExtensionContextValid()) {
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message.action === 'changeXPathColor') {
    // changeColorOfXPath();
    showImpersonateStatus();
  } else if (message.action === 'defaultAccountSet') {
    if (message.defaultAccountId) {
      VWoImpLoginData.defaultAccountId = message.defaultAccountId;
    }
    updateImpersonateButtonsVisibility();
    showImpersonateStatus();
  }
});
} // end isExtensionContextValid

document.addEventListener('keydown', function (event) {
  // Check if the key combination matches the desired shortcut (e.g., Ctrl + Shift + K)
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === 'e') {
    // Perform the desired action when the shortcut is triggered
    openModal();
    // Add your code to execute the desired action here
  } else if (event.altKey && event.key === 'd') {
    event.preventDefault();
    VWoImpLoginData.impersonateDefaultAccount();
  }
});

// Create the impersonate button
function createImpersonateButton() {
  const panel = document.getElementById('vwoImpPanel');
  if (!panel) return;
  
  // Check if buttons already exist to prevent duplicates
  if (document.getElementById('vwoExitImpersonateBtn') || document.getElementById('vwoDefaultImpersonateBtn')) {
    return;
  }
  
  // Create exit impersonate button
  const exitButton = document.createElement('button');
  exitButton.textContent = 'Exit Impersonation';
  exitButton.id = 'vwoExitImpersonateBtn';
  exitButton.addEventListener('click', VWoImpLoginData.exitImpersonate);
  exitButton.style.display = 'none';

  // Create default impersonate button
  const defaultImpersonateButton = document.createElement('button');
  defaultImpersonateButton.textContent = 'Use Default Account';
  defaultImpersonateButton.id = 'vwoDefaultImpersonateBtn';
  defaultImpersonateButton.addEventListener('click', VWoImpLoginData.impersonateDefaultAccount);
  defaultImpersonateButton.style.display = 'none';

  panel.appendChild(exitButton);
  panel.appendChild(defaultImpersonateButton);
  
  // Set initial visibility
  updateImpersonateButtonsVisibility();
}

// Function to update impersonate button visibility
function updateImpersonateButtonsVisibility() {
  const exitButton = document.getElementById('vwoExitImpersonateBtn');
  const defaultImpersonateButton = document.getElementById('vwoDefaultImpersonateBtn');
  
  if (!exitButton || !defaultImpersonateButton) return;
  
  chrome.storage.local.get(['defaultAccountId', 'originalAccountId', 'currentAccountId'], function(result) {
    const defaultAccountId = String(result.defaultAccountId || '');
    const originalAccountId = String(result.originalAccountId || '');
    const currentAccountId = String(result.currentAccountId || '');
    
    if (currentAccountId && originalAccountId && 
        currentAccountId !== originalAccountId && 
        originalAccountId !== "undefined" && 
        currentAccountId !== "undefined") {
      exitButton.style.display = 'inline-block';
    } else {
      exitButton.style.display = 'none';
    }
    
    if (currentAccountId && defaultAccountId && 
        currentAccountId !== defaultAccountId && 
        defaultAccountId !== "undefined" && 
        currentAccountId !== "undefined") {
      defaultImpersonateButton.style.display = 'inline-block';
    } else {
      defaultImpersonateButton.style.display = 'none';
    }
  });
}

// Function to perform SSO login
function isAllowedRedirect(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.vwo.com') || parsed.hostname.endsWith('.wingify.com');
  } catch (e) {
    return false;
  }
}

function performSSOLogin(email, accountId, impersonateLoader) {
  // Safety net — hide loader after 15s no matter what
  const loaderTimeout = setTimeout(() => {
    if (impersonateLoader) impersonateLoader.hideLoader();
    VWoImpLoginData.displayErrorMessage(
      'Exit Impersonation Failed',
      'SSO login timed out. Please try again or log out manually.'
    );
  }, 15000);

  const authBase = getAuthBaseUrl();

  fetch(authBase + 'login/sso', {
    method: 'POST',
    headers: {
      'Accept': 'application/json, */*',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ username: email }),
    credentials: 'include'
  })
    .then(async (response) => {
      let data = {};
      const text = await response.text();
      if (text) {
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.warn('SSO response was not JSON:', text.slice(0, 200));
        }
      }
      return { response, data };
    })
    .then(({ response, data }) => {
      clearTimeout(loaderTimeout);

      const redirectUrl = data.url || data.redirectUrl || data.redirect_url;
      if (redirectUrl && isAllowedRedirect(redirectUrl)) {
        window.location.href = redirectUrl;
        return;
      }

      // SSO often returns no URL — switch back via /access (same as background.js flow)
      if (response.ok && accountId) {
        window.location.href = authBase + 'access?accountId=' + encodeURIComponent(accountId);
        return;
      }

      if (impersonateLoader) impersonateLoader.hideLoader();
      const detail = data.message || data.error || ('HTTP ' + response.status);
      VWoImpLoginData.displayErrorMessage(
        'Exit Impersonation Failed',
        'SSO login did not complete. ' + detail + '\nPlease try logging out manually.'
      );
    })
    .catch(error => {
      clearTimeout(loaderTimeout);
      console.error('Error during SSO login:', error);
      if (impersonateLoader) impersonateLoader.hideLoader();
      VWoImpLoginData.displayErrorMessage('Exit Impersonation Failed', 'SSO request failed: ' + error.message);
    });
}

// Get account IDs as strings for comparison
function getAccountIdString(id) {
  if (id === undefined || id === null) return '';
  return String(id).trim();
}

// Check if user is impersonating an account
function isImpersonating(callback) {
  chrome.storage.local.get(['defaultAccountId', 'originalAccountId', 'currentAccountId'], function(result) {
    const defaultAccountId = getAccountIdString(result.defaultAccountId);
    const originalAccountId = getAccountIdString(result.originalAccountId);
    const currentAccountId = getAccountIdString(result.currentAccountId);
    
    // If we don't have valid account IDs yet, return false
    if (!currentAccountId || !defaultAccountId) {
      callback(false);
      return;
    }
    
    // User is impersonating if current account is different from default
    const isImpersonating = currentAccountId !== defaultAccountId && 
                           currentAccountId !== originalAccountId &&
                           defaultAccountId !== "undefined" && 
                           originalAccountId !== "undefined" &&
                           currentAccountId !== "undefined" &&
                           defaultAccountId !== "" &&
                           originalAccountId !== "";
    
    callback(isImpersonating);
  });
}

// Add or remove hide class
function toggleElementVisibility(element, shouldHide) {
  if (!element) return;
  
  if (shouldHide) {
    element.classList.add('hide');
  } else {
    element.classList.remove('hide');
  }
}

// Hide impersonation UI elements
function hideImpersonationElements() {
  let elements = document.querySelectorAll(".floatingImpersonatedDisplayBar");
  if (elements && elements.length > 0) {
    elements.forEach(element => {
      element.classList.add('hide');
    });
  }
  const dock = document.getElementById('vwoImpSideDock');
  if (dock) dock.classList.remove('vwo-impersonating');
}

// Show impersonation UI elements
function showImpersonationElements() {
  let elements = document.querySelectorAll(".floatingImpersonatedDisplayBar");
  if (elements && elements.length > 0) {
    elements.forEach(element => {
      element.classList.remove('hide');
    });
  }
  const dock = document.getElementById('vwoImpSideDock');
  if (dock) dock.classList.add('vwo-impersonating');
}

// Function to check current account ID from localStorage
function checkCurrentAccountFromStorage() {
  safeStorageAccess(() => {
    chrome.storage.local.get(['currentAccountId', 'defaultAccountId', 'originalAccountId'], function(result) {
      if (chrome.runtime.lastError) {
        console.warn('Chrome storage error:', chrome.runtime.lastError);
        return;
      }
    });
  });
}

// Call the function to check current account
checkCurrentAccountFromStorage();