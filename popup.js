document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('impersonateForm');
  const accountIdInput = document.getElementById('accountIdInput');
  const emailInput = document.getElementById('emailInput');
  const defaultAccountIdInput = document.getElementById('defaultAccountIdInput');
  const defaultAccountNameInput = document.getElementById('defaultAccountNameInput');
  const statusMessage = document.getElementById('statusMessage');
  
  // Add visual indicator if original account info is missing
  function checkOriginalAccountStatus() {
    const missingOriginalAccount = !accountIdInput.value || !emailInput.value;
    
    if (missingOriginalAccount) {
      const originalSection = accountIdInput.closest('.section');
      originalSection.style.border = '2px solid #f44336';
      originalSection.style.padding = '15px';
      originalSection.style.borderRadius = '5px';
      
      const warningText = document.createElement('p');
      warningText.className = 'error-message';
      warningText.innerHTML = '⚠️ <strong>Important:</strong> Please set your original account details to enable "Exit Impersonation" functionality';
      warningText.style.marginTop = '5px';
      warningText.style.marginBottom = '0';
      
      // Only add the warning if it doesn't exist yet
      if (!originalSection.querySelector('.error-message')) {
        originalSection.querySelector('h2').insertAdjacentElement('afterend', warningText);
      }
    }
  }

  // Load saved data
  chrome.storage.local.get(['originalAccountId', 'originalEmail', 'defaultAccountId', 'defaultAccountName'], function(result) {
    if (result.originalAccountId) accountIdInput.value = result.originalAccountId;
    if (result.originalEmail) emailInput.value = result.originalEmail;
    if (result.defaultAccountId) defaultAccountIdInput.value = result.defaultAccountId;
    if (result.defaultAccountName) defaultAccountNameInput.value = result.defaultAccountName;
    
    // Check if original account info is set
    checkOriginalAccountStatus();
  });

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const originalAccountId = accountIdInput.value.trim();
    const originalEmail = emailInput.value.trim();
    const defaultAccountId = defaultAccountIdInput.value.trim();
    const defaultAccountName = defaultAccountNameInput.value.trim();

    if (!originalAccountId) {
      statusMessage.textContent = 'Please enter your original Account ID.';
      statusMessage.className = 'error-message';
      return;
    }
    
    if (!originalEmail) {
      statusMessage.textContent = 'Please enter your original Email for SSO login.';
      statusMessage.className = 'error-message';
      return;
    }

    // Save data to storage
    chrome.storage.local.set({ 
      originalAccountId, 
      originalEmail,
      defaultAccountId,
      defaultAccountName 
    }, function() {
      statusMessage.textContent = 'Settings saved successfully!';
      statusMessage.className = 'success-message';
      
      // If a default account was set, notify content.js
      if (defaultAccountId) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
          if (tabs[0].url && tabs[0].url.includes('app.vwo.com')) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'defaultAccountSet',
              defaultAccountId,
              defaultAccountName
            });
          }
        });
      }
    });
  });
});