/**
 * Storage module with encrypted PAT support.
 *
 * Provides:
 * - Encrypted storage for sensitive data (PATs)
 * - Plain storage for non-sensitive data (preferences, mention state)
 * - Typed accessors for common operations
 */

import { STORAGE_KEYS, DEFAULT_PREFERENCES } from './config.js';

// Encryption constants
const ENCRYPTION_ALGORITHM = 'AES-GCM';
const KEY_DERIVATION_ALGORITHM = 'PBKDF2';
const KEY_DERIVATION_ITERATIONS = 100000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 16;

/**
 * Derives an encryption key from a passphrase using PBKDF2.
 * Uses a device-specific identifier as the passphrase base.
 */
async function deriveKey(salt) {
  // Use extension ID as part of the key derivation
  // This ties encrypted data to this specific extension installation
  const extensionId = chrome.runtime.id;
  const passphrase = `ado-mentions-${extensionId}`;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    KEY_DERIVATION_ALGORITHM,
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: KEY_DERIVATION_ALGORITHM,
      salt: salt,
      iterations: KEY_DERIVATION_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ENCRYPTION_ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a string value.
 * Returns a base64-encoded string containing salt + iv + ciphertext.
 */
async function encrypt(plaintext) {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);

  // Generate random salt and IV
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Derive key and encrypt
  const key = await deriveKey(salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    data
  );

  // Combine salt + iv + ciphertext
  const combined = new Uint8Array(salt.length + iv.length + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts a base64-encoded encrypted string.
 */
async function decrypt(encryptedBase64) {
  // Decode base64
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

  // Extract salt, iv, and ciphertext
  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  // Derive key and decrypt
  const key = await deriveKey(salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: ENCRYPTION_ALGORITHM, iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Loads all extension state from storage.
 */
export async function loadState() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.ORGANIZATIONS,
    STORAGE_KEYS.MENTIONS,
    STORAGE_KEYS.READ_IDS,
    STORAGE_KEYS.LAST_POLL,
    STORAGE_KEYS.PREFERENCES,
  ]);

  return {
    organizations: data[STORAGE_KEYS.ORGANIZATIONS] || [],
    mentions: data[STORAGE_KEYS.MENTIONS] || [],
    readIds: new Set(data[STORAGE_KEYS.READ_IDS] || []),
    lastPoll: data[STORAGE_KEYS.LAST_POLL] || {},
    preferences: { ...DEFAULT_PREFERENCES, ...data[STORAGE_KEYS.PREFERENCES] },
  };
}

/**
 * Saves organizations to storage.
 * Note: PATs should already be encrypted before calling this.
 */
export async function saveOrganizations(organizations) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.ORGANIZATIONS]: organizations,
  });
}

/**
 * Saves mentions to storage.
 */
export async function saveMentions(mentions) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.MENTIONS]: mentions,
  });
}

/**
 * Saves read mention IDs to storage.
 */
export async function saveReadIds(readIds) {
  const idsArray = readIds instanceof Set ? Array.from(readIds) : readIds;
  await chrome.storage.local.set({
    [STORAGE_KEYS.READ_IDS]: idsArray,
  });
}

/**
 * Updates the last poll timestamp for an organization.
 */
export async function updateLastPoll(orgUrl, timestamp) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_POLL);
  const lastPoll = data[STORAGE_KEYS.LAST_POLL] || {};
  lastPoll[orgUrl] = timestamp;
  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_POLL]: lastPoll,
  });
}

/**
 * Saves user preferences.
 */
export async function savePreferences(preferences) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.PREFERENCES]: preferences,
  });
}

/**
 * Encrypts a PAT for secure storage.
 */
async function encryptPat(pat) {
  return encrypt(pat);
}

/**
 * Decrypts a stored PAT.
 */
async function decryptPat(encryptedPat) {
  return decrypt(encryptedPat);
}

/**
 * Clears all extension data.
 */
export async function clearAllData() {
  await chrome.storage.local.clear();
}

/**
 * Adds a new organization with encrypted PAT.
 */
export async function addOrganization(orgUrl, orgName, pat, pollIntervalMinutes = 5) {
  const state = await loadState();

  // Check if org already exists
  const existingIndex = state.organizations.findIndex(o => o.orgUrl === orgUrl);
  if (existingIndex >= 0) {
    throw new Error('Organization already exists');
  }

  // Encrypt PAT
  const encryptedPat = await encryptPat(pat);

  // Add org
  state.organizations.push({
    orgUrl,
    orgName,
    pat: encryptedPat,
    enabled: true,
    pollIntervalMinutes,
    lastError: null,
  });

  await saveOrganizations(state.organizations);
  return state.organizations;
}

/**
 * Updates an existing organization.
 */
export async function updateOrganization(orgUrl, updates) {
  const state = await loadState();
  const org = state.organizations.find(o => o.orgUrl === orgUrl);

  if (!org) {
    throw new Error('Organization not found');
  }

  // If PAT is being updated, encrypt it
  if (updates.pat) {
    updates.pat = await encryptPat(updates.pat);
  }

  Object.assign(org, updates);
  await saveOrganizations(state.organizations);
  return state.organizations;
}

/**
 * Removes an organization.
 */
export async function removeOrganization(orgUrl) {
  const state = await loadState();
  const index = state.organizations.findIndex(o => o.orgUrl === orgUrl);

  if (index < 0) {
    throw new Error('Organization not found');
  }

  state.organizations.splice(index, 1);

  // Also remove related data
  delete state.lastPoll[orgUrl];

  // Remove mentions from this org
  const filteredMentions = state.mentions.filter(m => m.orgUrl !== orgUrl);

  // Load and clean per-org storage
  const perOrgData = await chrome.storage.local.get([
    STORAGE_KEYS.LAST_PR_POLL,
    STORAGE_KEYS.PR_THREAD_CACHE,
    STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS,
  ]);

  const lastPRPoll = perOrgData[STORAGE_KEYS.LAST_PR_POLL] || {};
  const prThreadCache = perOrgData[STORAGE_KEYS.PR_THREAD_CACHE] || {};
  const assignedIds = perOrgData[STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS] || {};

  delete lastPRPoll[orgUrl];
  delete prThreadCache[orgUrl];
  delete assignedIds[orgUrl];

  await Promise.all([
    saveOrganizations(state.organizations),
    saveMentions(filteredMentions),
    chrome.storage.local.set({
      [STORAGE_KEYS.LAST_POLL]: state.lastPoll,
      [STORAGE_KEYS.LAST_PR_POLL]: lastPRPoll,
      [STORAGE_KEYS.PR_THREAD_CACHE]: prThreadCache,
      [STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS]: assignedIds,
    }),
  ]);

  return state.organizations;
}

/**
 * Gets a decrypted PAT for an organization.
 */
export async function getDecryptedPat(orgUrl) {
  const state = await loadState();
  const org = state.organizations.find(o => o.orgUrl === orgUrl);

  if (!org) {
    throw new Error('Organization not found');
  }

  return decryptPat(org.pat);
}

// =============================================================================
// PR Poll State
// =============================================================================

/**
 * Gets all poll-related state for an organization in a single storage read.
 * This is more efficient than calling getLastPRPoll, getPRThreadCache, and
 * getAssignedWorkItemIds separately.
 *
 * @param {string} orgUrl - Organization URL
 * @returns {Promise<{lastPRPollTime: string|null, prThreadCache: Object, assignedWorkItemIds: number[]|null}>}
 *   `assignedWorkItemIds` is `null` if the org has never been polled (signals first-poll silent seed).
 */
export async function getPollState(orgUrl) {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.LAST_PR_POLL,
    STORAGE_KEYS.PR_THREAD_CACHE,
    STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS,
  ]);

  const lastPRPoll = data[STORAGE_KEYS.LAST_PR_POLL] || {};
  const threadCache = data[STORAGE_KEYS.PR_THREAD_CACHE] || {};
  const assignedIds = data[STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS] || {};

  return {
    lastPRPollTime: lastPRPoll[orgUrl] || null,
    prThreadCache: threadCache[orgUrl] || {},
    // Use Object.prototype.hasOwnProperty so an explicit empty array is preserved
    // (empty array means "we polled and you're assigned to nothing"; null means
    // "we've never polled this org, do a silent seed instead of notifying").
    assignedWorkItemIds: Object.prototype.hasOwnProperty.call(assignedIds, orgUrl)
      ? assignedIds[orgUrl]
      : null,
  };
}

/**
 * Updates the last PR poll timestamp for an organization.
 */
export async function updateLastPRPoll(orgUrl, timestamp) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_PR_POLL);
  const lastPRPoll = data[STORAGE_KEYS.LAST_PR_POLL] || {};
  lastPRPoll[orgUrl] = timestamp;
  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_PR_POLL]: lastPRPoll,
  });
}

/**
 * Saves the entire PR thread cache for an organization.
 */
export async function savePRThreadCache(orgUrl, prCache) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.PR_THREAD_CACHE);
  const cache = data[STORAGE_KEYS.PR_THREAD_CACHE] || {};
  cache[orgUrl] = prCache;
  await chrome.storage.local.set({
    [STORAGE_KEYS.PR_THREAD_CACHE]: cache,
  });
}

// =============================================================================
// Assignment Set State
// =============================================================================

/**
 * Saves the per-org set of currently-assigned work item IDs.
 *
 * @param {string} orgUrl - Organization URL
 * @param {number[]} ids - Work item IDs the user is currently assigned to
 */
export async function saveAssignedWorkItemIds(orgUrl, ids) {
  const data = await chrome.storage.local.get(STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS);
  const all = data[STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS] || {};
  all[orgUrl] = ids;
  await chrome.storage.local.set({
    [STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS]: all,
  });
}

// =============================================================================
// One-time migration
// =============================================================================

/**
 * Runs the one-time migration to switch from the old date-filtered assignment
 * detection to the set-based approach.
 *
 * - Wipes existing `subtype === 'assignment'` mentions (they have wrong/ratcheted
 *   timestamps and authors that we can't recover).
 * - Deletes the old `ado_last_assign` storage entry (no longer used).
 * - Leaves `ASSIGNED_WORK_ITEM_IDS` unset so the next poll silently seeds without
 *   firing notifications for assignments the user already had.
 *
 * Idempotent: a migration flag prevents repeat runs.
 */
export async function runAssignmentDetectionMigration() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.ASSIGNMENT_MIGRATION_DONE,
    STORAGE_KEYS.MENTIONS,
  ]);

  if (data[STORAGE_KEYS.ASSIGNMENT_MIGRATION_DONE]) {
    return { ran: false };
  }

  const mentions = data[STORAGE_KEYS.MENTIONS] || [];
  const filtered = mentions.filter(m => m.subtype !== 'assignment');
  const removed = mentions.length - filtered.length;

  await chrome.storage.local.set({
    [STORAGE_KEYS.MENTIONS]: filtered,
    [STORAGE_KEYS.ASSIGNMENT_MIGRATION_DONE]: true,
  });

  // Remove the dead `ado_last_assign` key (the old per-org "last assignment
  // check time" map). Reference by literal so the constant can be deleted.
  await chrome.storage.local.remove('ado_last_assign');

  console.log(`Assignment detection migration: removed ${removed} legacy assignment mentions`);
  return { ran: true, removed };
}

/**
 * Cleans up assignment notifications whose `timestamp` ended up as ADO's
 * `9999-01-01T00:00:00Z` sentinel (or any other implausibly-future date).
 *
 * Pre-fix, the matcher could pick a synthetic current-state revision returned
 * by `/updates` with that sentinel revisedDate, leading to a stored timestamp
 * in the year 9999 — which sorted to the top of the popup and rendered as
 * "just now".
 *
 * Removes the broken notifications and strips their work item IDs from
 * `assignedWorkItemIds` for the owning org so the next poll will treat them
 * as new transitions and re-create the notifications with correct timestamps.
 *
 * Idempotent via a dedicated flag.
 */
export async function runAssignmentSentinelCleanup() {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.ASSIGNMENT_SENTINEL_CLEANUP_DONE,
    STORAGE_KEYS.MENTIONS,
    STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS,
  ]);

  if (data[STORAGE_KEYS.ASSIGNMENT_SENTINEL_CLEANUP_DONE]) {
    return { ran: false };
  }

  const mentions = data[STORAGE_KEYS.MENTIONS] || [];
  const assignedIds = data[STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS] || {};

  const isBadTimestamp = (ts) => {
    const t = new Date(ts).getTime();
    return isNaN(t) || t > Date.now() + 365 * 24 * 60 * 60 * 1000;
  };

  // Identify bad assignment notifications and the (orgUrl, itemId) pairs to
  // strip from each org's assigned-set so the next poll re-detects them.
  const badByOrg = {};
  const filtered = mentions.filter(m => {
    if (m.subtype !== 'assignment') return true;
    if (!isBadTimestamp(m.timestamp)) return true;
    if (m.orgUrl && m.itemId != null) {
      (badByOrg[m.orgUrl] = badByOrg[m.orgUrl] || new Set()).add(m.itemId);
    }
    return false;
  });
  const removed = mentions.length - filtered.length;

  for (const orgUrl of Object.keys(badByOrg)) {
    const current = assignedIds[orgUrl];
    if (!Array.isArray(current)) continue;
    assignedIds[orgUrl] = current.filter(id => !badByOrg[orgUrl].has(id));
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.MENTIONS]: filtered,
    [STORAGE_KEYS.ASSIGNED_WORK_ITEM_IDS]: assignedIds,
    [STORAGE_KEYS.ASSIGNMENT_SENTINEL_CLEANUP_DONE]: true,
  });

  console.log(`Assignment sentinel cleanup: removed ${removed} bad-timestamp assignment mentions`);
  return { ran: true, removed };
}
