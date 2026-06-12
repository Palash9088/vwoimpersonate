# VWO Impersonate

> **⚠️ Internal tooling — authorized use only**
> This extension is intended exclusively for authorized [Wingify / VWO](https://vwo.com) employees. It provides privileged access to account impersonation and internal APIs. Do not install or use this extension unless you are an authorized VWO team member. Unauthorized use may violate VWO's terms of service and applicable laws.

A Chrome extension (Manifest V3) for VWO internal use. Lets you switch into customer accounts, monitor impersonation status, and debug account details — across both `app.vwo.com` and testapp environments.

---

## Features

- **Account impersonation** — enter any VWO account ID and jump straight in
- **Exit impersonation** — one-click logout + SSO re-login back to your own account
- **Default account** — configure a quick-switch target in the popup
- **Side hover dock** — unobtrusive tab on the right edge; expands on hover with action buttons and an impersonation indicator dot
- **Debugger modal** (`⌘⇧E`) — three tabs:
  - **Debugger** — account timezone, feature flag search, impersonate by ID, switch campaign by ID
  - **/login Response** — live JSON viewer for the `/login` API with refresh + copy
  - **Timezone Converter** — convert a date range from any timezone to UTC
- **Auto-refresh on testapp** — any `*.vwo.com` page whose URL contains `testapp` reloads every 15 minutes automatically
- **Extension reload banner** — if the extension is updated while tabs are open, a toast prompts you to refresh instead of showing a cryptic error

---

## Installation

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repo folder
5. The extension icon appears in your toolbar

---

## Setup

Click the extension icon and fill in:

| Field | Description |
|---|---|
| **Original Account ID** | Your real VWO account ID (used for exit impersonation) |
| **Original Email** | Your SSO email (used to re-login after exit) |
| **Default Account ID** | Optional quick-switch target account |
| **Default Account Name** | Display label for the default account |

Click **Save Settings**.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘ ⇧ E` / `Ctrl ⇧ E` | Open / close the Debugger modal |
| `Alt + D` | Switch to the default account |
| `Esc` | Close the modal |

---

## How it Works

```
popup.html / popup.js
  └── saves settings to chrome.storage.local
  └── notifies content.js when default account changes

content.js  (injected on *.vwo.com)
  ├── Side dock UI (hover to expand)
  ├── Debugger modal (⌘⇧E)
  ├── syncTestappRefresh() — 15-min auto-reload on testapp URLs
  ├── MutationObserver — tracks SPA URL changes
  └── fetch /login, /logout, /login/sso  (relative URLs, same domain)

background.js  (service worker)
  └── executeScript / exitImpersonate helpers
```

**Account switching** uses `{currentDomain}/access?accountId=...` so it works on both `app.vwo.com` and testapp environments.

**Exit impersonation** always targets `app.vwo.com` since your original account and SSO live there.

---

## File Structure

```
vwoimpersonate/
├── manifest.json       Extension manifest (MV3)
├── content.js          Main logic injected into VWO pages
├── popup.html          Settings popup UI
├── popup.js            Popup logic
├── popup.css           Popup styles
├── background.js       Service worker
└── icon128.png         Extension icon
```

---

## Development

No build step — load unpacked directly.  
After editing any file, go to `chrome://extensions` and click the reload button on the extension, then refresh the VWO tab.
