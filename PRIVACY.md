# Privacy Policy

**ADO @ Mention Notifications**
**Last Updated**: March 2026

## Overview

This browser extension monitors Azure DevOps for @mentions of the current user and provides notifications. This privacy policy explains what data the extension collects, how it is stored, and how it is used.

## Data Collection

The extension collects and stores the following information locally in your browser:

| Data Type | Purpose | Storage Location |
| --------- | ------- | ---------------- |
| Azure DevOps Organization URL | Connect to your ADO instance | Browser local storage |
| Personal Access Token (PAT) | Authenticate with Azure DevOps API | Browser local storage (encrypted) |
| Mention history | Display @mentions in the popup | Browser local storage |
| Read/unread state | Track which mentions you've seen | Browser local storage |
| User preferences | Remember notification settings | Browser local storage |

## Data Storage

- All data is stored **locally in your browser** using Chrome's `chrome.storage.local` API
- Your Personal Access Token is **encrypted** before storage using AES-256-GCM encryption
- No data is stored on external servers controlled by this extension
- Data persists until you clear it or uninstall the extension

## Data Transmission

- Your Personal Access Token is transmitted **only** to Azure DevOps API endpoints:
  - `dev.azure.com` - Work item and project APIs
  - `app.vssps.visualstudio.com` - User profile API
- The extension communicates with Azure DevOps APIs to:
  - Validate your connection
  - Query for work items where you were mentioned
  - Retrieve work item comments
  - Retrieve your user profile information
- **No data is transmitted to any third parties**
- **No analytics or tracking services are used**

## Data Sharing

This extension does **not**:

- Share your data with third parties
- Sell or monetize your data
- Use analytics or telemetry services
- Track your browsing activity

## Data Retention

- Mention history is limited to the most recent 500 mentions
- Azure DevOps only returns mentions from the last 30 days
- Data is retained in your browser until you explicitly delete it
- Use the "Clear All Data" button in the extension settings to delete all stored information
- Uninstalling the extension will remove all stored data

## How to Delete Your Data

1. Open the extension popup by clicking the extension icon
2. Click the settings (gear) icon
3. Click "Clear All Data"
4. Confirm the deletion

Alternatively, you can:

- Clear browser data for this extension through browser settings
- Uninstall the extension

## Security

- Personal Access Tokens are encrypted using industry-standard AES-256-GCM encryption
- The encryption key is derived using PBKDF2 with 100,000 iterations
- All communication with Azure DevOps uses HTTPS
- The extension only requests PATs with minimal required scope (Work Items: Read)

## Permissions

The extension requires the following browser permissions:

| Permission | Why It's Needed |
| ---------- | --------------- |
| `storage` | Store your settings, credentials, and mention history locally |
| `alarms` | Schedule periodic polling for new mentions |
| `notifications` | Display browser notifications when new mentions are detected (optional) |
| `host_permissions` | Access Azure DevOps APIs to query mentions |

## Scope

This extension is intended for users who work with Azure DevOps and want to be notified when they are @mentioned in work item comments.

## Changes to This Policy

If this privacy policy is updated, the "Last Updated" date at the top will be changed. Continued use of the extension after changes constitutes acceptance of the updated policy.

## Contact

For questions about this privacy policy or the extension's data practices, please contact the extension maintainer.

---

*This extension is not affiliated with, endorsed by, or sponsored by Microsoft Corporation.*
