function getAccountId(){
    return angular.element(document.body).scope().loggedInUser.currentAccount.id;
}
// Listen for messages from content script
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'executeScript') {
        // Execute script to retrieve accountId
        chrome.scripting.executeScript({
            target: { tabId: sender.tab.id },
            // function: () => ({ accountId: window.angular.element(document.body).scope().loggedInUser.currentAccount.id })
            function: () => ({ accountId: document.title })
        }).then(result => {
            // Send response with accountId to content script
            sendResponse({ accountId: result[0].result.accountId });
        }).catch(error => {
            console.error('Script execution failed:', error.message);
            sendResponse({ error: error.message });
        });
        // Return true to indicate that sendResponse will be called asynchronously
        return true;
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exitImpersonate') {
    // Step 1: Logout
    fetch('https://app.vwo.com/logout', { credentials: 'include' })
      .then(() => {
        // Step 2: Perform SSO login
        return fetch('https://app.vwo.com/login/sso', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username: request.email }),
          credentials: 'include'
        });
      })
      .then(response => {
        if (!response.ok) {
          throw new Error('SSO login failed');
        }
        // Step 3: Switch to the original account
        return fetch(`https://app.vwo.com/access?accountId=${request.accountId}`, {
          credentials: 'include'
        });
      })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error during impersonation exit:', error);
        sendResponse({ success: false });
      });

    return true; // Indicates that the response is sent asynchronously
  }
});