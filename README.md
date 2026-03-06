# ADO @ Mention Notifications

A browser extension that notifies you when someone @mentions you in Azure DevOps work item comments.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![Edge](https://img.shields.io/badge/Edge-Compatible-green)
![Chrome](https://img.shields.io/badge/Chrome-Compatible-green)

## Features

- **Badge notifications** - Unread mention count displayed on the extension icon
- **Browser notifications** - Optional push notifications for new mentions (opt-in)
- **Multi-organization support** - Monitor multiple Azure DevOps organizations
- **Read tracking** - Mark mentions as read; state persists across sessions
- **Secure credential storage** - PATs encrypted with AES-256-GCM

## Screenshots

<!-- TODO: Add screenshots -->
<!-- ![Popup showing mentions](docs/screenshot-popup.png) -->
<!-- ![Settings panel](docs/screenshot-settings.png) -->

## Installation

### From Source (Developer Mode)

1. Clone this repository:

   ```bash
   git clone https://github.com/YOUR_USERNAME/extension-oh-ado-cmt-atsign-notifications.git
   ```

2. Open your browser's extension management page:
   - **Edge**: `edge://extensions`
   - **Chrome**: `chrome://extensions`

3. Enable **Developer mode** (toggle in top-right)

4. Click **Load unpacked** and select the cloned repository folder

5. The extension icon will appear in your toolbar

## Setup

1. Click the extension icon to open the popup
2. Click the **Settings** (gear) icon
3. Click **+ Add Organization**
4. Enter your Azure DevOps organization URL (e.g., `https://dev.azure.com/myorg` or just `myorg`)
5. Create a Personal Access Token (PAT) with **Work Items: Read** scope
   - Click the "Create a PAT" link for quick access to the token creation page
6. Paste your PAT and check the consent box
7. Click **Save**

The extension will begin polling for @mentions immediately.

## How It Works

The extension uses Azure DevOps' WIQL `@recentMentions` macro to query for work items where you've been mentioned in the last 30 days. It then fetches comments from those work items and identifies which ones contain @mentions of your user account.

### Polling

- Default poll interval: **5 minutes**
- Configurable per organization
- Respects ADO rate limits with automatic backoff

### Detection

Currently supports:

- Work item comment @mentions

Future support planned for:

- Pull request comment @mentions
- Discussion thread @mentions

## Privacy & Security

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

- **PATs are encrypted** using AES-256-GCM with PBKDF2 key derivation before storage
- **Data stays local** - All data is stored in your browser's local storage
- **No external servers** - The extension only communicates with Azure DevOps APIs
- **Minimal permissions** - Only requests the permissions necessary to function

### Required Permissions

| Permission | Purpose |
| ---------- | ------- |
| `storage` | Store encrypted credentials and mention history |
| `alarms` | Schedule periodic polling |
| `notifications` | Display browser notifications (optional feature) |
| `host_permissions` | Access Azure DevOps APIs |

## Development

### Project Structure

```text
├── manifest.json           # Extension manifest (MV3)
├── background.js           # Service worker entry point
├── src/
│   ├── config.js           # Configuration constants
│   ├── storage.js          # Encrypted storage module
│   ├── ado/
│   │   ├── api-client.js   # Azure DevOps REST API client
│   │   └── mentions.js     # Mention detection logic
│   ├── background/
│   │   ├── index.js        # Background service initialization
│   │   ├── polling.js      # Polling scheduler
│   │   ├── messages.js     # Message handling
│   │   ├── notifications.js# Badge and push notifications
│   │   └── state.js        # State management
│   └── ui/
│       ├── popup.html      # Popup UI markup
│       ├── popup.css       # Popup styles
│       └── popup.js        # Popup logic
├── icons/                  # Extension icons
└── design/                 # Architecture documentation
```

### Building

No build step required. The extension runs directly from source.

### Testing Locally

1. Load the extension in developer mode (see Installation)
2. Make changes to the source files
3. Click the refresh icon on the extension card in `edge://extensions`
4. Test your changes

## Troubleshooting

### "Authentication failed" error

- Verify your PAT has not expired
- Ensure the PAT has **Work Items: Read** scope
- Check that the organization URL is correct

### No mentions appearing

- Confirm you have been @mentioned in a work item comment within the last 30 days
- Click the refresh button to force an immediate poll
- Check the browser console for errors (right-click extension icon → Inspect)

### Extension not polling

- Check that the organization is enabled in Settings
- The service worker may have been suspended; clicking the extension icon will wake it

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

<!-- TODO: Add license -->
This project is not yet licensed. All rights reserved.

## Acknowledgments

- Built for use with [Azure DevOps](https://azure.microsoft.com/en-us/products/devops)
- Uses the [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/)
