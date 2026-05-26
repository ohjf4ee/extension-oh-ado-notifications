/**
 * Mention detection module.
 *
 * Detects @ mentions of the current user in Azure DevOps.
 * Primary strategy: WIQL @recentMentions macro.
 * Future: PR thread scanning, content script DOM observation (stubbed).
 */

import { API_CONFIG } from '../config.js';

/**
 * Creates a unique mention ID.
 */
export function createMentionId(orgUrl, type, itemId, commentId) {
  return `${orgUrl}:${type}:${itemId}:${commentId || 'item'}`;
}

/**
 * Checks if a comment HTML contains a mention of the given user.
 *
 * ADO comments use `data-vss-mention` attributes for @ mentions:
 * <a href="#" data-vss-mention="version:2.0,id:abc123">@John Smith</a>
 */
export function commentMentionsUser(html, currentUser) {
  if (!html || !currentUser) {
    return false;
  }

  // Check for data-vss-mention attribute with user ID
  // Format can be either:
  //   data-vss-mention="version:2.0,{guid}" (newer format)
  //   data-vss-mention="version:2.0,id:{guid}" (older format with id: prefix)
  const mentionPattern = /data-vss-mention="version:[^,]*,(?:id:)?([^"]+)"/gi;
  let match;

  while ((match = mentionPattern.exec(html)) !== null) {
    const mentionedUserId = match[1];
    if (mentionedUserId === currentUser.id ||
        mentionedUserId === currentUser.publicAlias) {
      return true;
    }
  }

  // Fallback: Check for @displayName or @email patterns in text
  const userPatterns = [
    currentUser.displayName,
    currentUser.emailAddress,
    currentUser.publicAlias,
  ].filter(Boolean);

  const lowerHtml = html.toLowerCase();
  for (const pattern of userPatterns) {
    if (pattern && lowerHtml.includes(`@${pattern.toLowerCase()}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts a plain text preview from HTML content.
 */
export function extractPreview(html, maxLength = 150) {
  if (!html) {
    return '';
  }

  // Strip HTML tags and decode entities
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Builds a URL to a work item comment.
 */
export function buildWorkItemCommentUrl(orgUrl, projectName, workItemId, commentId) {
  const project = encodeURIComponent(projectName);
  let url = `${orgUrl}/${project}/_workitems/edit/${workItemId}`;
  if (commentId) {
    url += `#${commentId}`;
  }
  return url;
}

/**
 * Builds a URL to a pull request or PR comment.
 *
 * @param {string} orgUrl - Organization URL
 * @param {string} projectName - Project name
 * @param {string} repositoryName - Repository name
 * @param {number} pullRequestId - Pull request ID
 * @param {Object} [options] - URL options
 * @param {string} [options.filePath] - File path for file comments
 * @param {boolean} [options.isOverview] - Whether to link to overview tab
 */
export function buildPRCommentUrl(orgUrl, projectName, repositoryName, pullRequestId, options = {}) {
  const project = encodeURIComponent(projectName);
  const repo = encodeURIComponent(repositoryName);
  let url = `${orgUrl}/${project}/_git/${repo}/pullrequest/${pullRequestId}`;

  if (options.filePath) {
    url += `?_a=files&path=${encodeURIComponent(options.filePath)}`;
  } else if (options.isOverview) {
    url += '?_a=overview';
  }

  return url;
}

/**
 * Checks if a comment was created by the current user.
 */
function isCommentByUser(comment, currentUser) {
  if (!comment.createdBy) return false;

  // Check by user ID
  if (comment.createdBy.id === currentUser.id) return true;

  // Check by uniqueName (email)
  if (currentUser.emailAddress &&
      comment.createdBy.uniqueName?.toLowerCase() === currentUser.emailAddress.toLowerCase()) {
    return true;
  }

  return false;
}

/**
 * Extracts mentions from a work item's comments.
 */
async function extractMentionsFromWorkItem(apiClient, workItem, currentUser) {
  const projectName = workItem.fields['System.TeamProject'];
  const comments = await apiClient.getWorkItemComments(projectName, workItem.id);
  const mentions = [];

  for (const comment of comments) {
    if (!commentMentionsUser(comment.text, currentUser)) continue;

    const mentionTimestamp = new Date(comment.createdDate).getTime();

    // Find the user's first comment after this mention (chronologically next)
    let userCommentedAfter = false;
    let userReplyPreview = null;
    let earliestReplyTime = Infinity;
    for (const c of comments) {
      const isUserComment = isCommentByUser(c, currentUser);
      const commentTime = new Date(c.createdDate).getTime();
      const isAfter = commentTime > mentionTimestamp;
      if (isUserComment && isAfter && commentTime < earliestReplyTime) {
        userCommentedAfter = true;
        earliestReplyTime = commentTime;
        userReplyPreview = extractPreview(c.text, 200);
      }
    }

    mentions.push({
      id: createMentionId(apiClient.orgUrl, 'workitem', workItem.id, comment.id),
      orgUrl: apiClient.orgUrl,
      orgName: apiClient.orgName,
      type: 'workitem',
      subtype: 'mention',
      itemId: workItem.id,
      itemTitle: workItem.fields['System.Title'],
      itemType: workItem.fields['System.WorkItemType'],
      projectName,
      repositoryName: null,
      commentId: comment.id,
      commentHtml: comment.text,
      commentPreview: extractPreview(comment.text),
      mentionedBy: {
        displayName: comment.createdBy.displayName,
        uniqueName: comment.createdBy.uniqueName,
        imageUrl: comment.createdBy.imageUrl,
      },
      timestamp: comment.createdDate,
      url: buildWorkItemCommentUrl(apiClient.orgUrl, projectName, workItem.id, comment.id),
      userCommentedAfter,
      userReplyPreview,
    });
  }

  return mentions;
}

/**
 * Detects work item mentions using the WIQL @recentMentions macro.
 *
 * This is the primary detection strategy. The @recentMentions macro
 * returns work items where the current user was mentioned in the last 30 days.
 *
 * @param {AdoApiClient} apiClient - Authenticated API client
 * @param {Object} currentUser - Current user info from apiClient.getCurrentUser()
 */
export async function detectWorkItemMentions(apiClient, currentUser) {
  // Query for work items where user was mentioned
  const wiql = `
    SELECT [System.Id], [System.Title], [System.TeamProject], [System.ChangedDate], [System.WorkItemType]
    FROM workitems
    WHERE [System.Id] IN (@recentMentions)
    ORDER BY [System.ChangedDate] DESC
  `;

  const workItemRefs = await apiClient.executeWiql(wiql);

  if (workItemRefs.length === 0) {
    return [];
  }

  // Batch fetch work item details
  const workItemIds = workItemRefs.map(wi => wi.id);

  const allWorkItems = [];
  for (let i = 0; i < workItemIds.length; i += API_CONFIG.maxWorkItemsPerBatch) {
    const batchIds = workItemIds.slice(i, i + API_CONFIG.maxWorkItemsPerBatch);
    const batchItems = await apiClient.getWorkItems(batchIds, [
      'System.Id',
      'System.Title',
      'System.TeamProject',
      'System.ChangedDate',
      'System.WorkItemType',
    ]);
    allWorkItems.push(...batchItems);
  }

  // Extract mentions from each work item's comments
  const allMentions = [];
  const warnings = [];
  for (const workItem of allWorkItems) {
    try {
      const mentions = await extractMentionsFromWorkItem(apiClient, workItem, currentUser);
      allMentions.push(...mentions);
    } catch (error) {
      // Log but continue with other work items
      console.error(`Error extracting mentions from work item ${workItem.id}:`, error);
      warnings.push(`Work item #${workItem.id}: ${error.message || 'fetch failed'}`);
    }
  }

  return { mentions: allMentions, warnings };
}

/**
 * Returns true if an identity-typed field value (an `IdentityRef` object, or
 * the string form `"Display Name <email>"`) refers to the given user.
 */
function identityValueMatchesUser(value, currentUser) {
  if (!value) return false;

  // ADO usually serializes update field values as strings, but defensively
  // accept the IdentityRef object form too.
  if (typeof value === 'object') {
    if (value.id && currentUser.id && value.id === currentUser.id) return true;
    if (value.uniqueName && currentUser.emailAddress &&
        value.uniqueName.toLowerCase() === currentUser.emailAddress.toLowerCase()) {
      return true;
    }
    return false;
  }

  if (typeof value !== 'string') return false;

  const emailMatch = value.match(/<([^>]+)>/);
  if (emailMatch && currentUser.emailAddress) {
    return emailMatch[1].toLowerCase() === currentUser.emailAddress.toLowerCase();
  }

  if (currentUser.displayName) {
    const lowerValue = value.toLowerCase();
    const lowerName = currentUser.displayName.toLowerCase();
    if (lowerValue === lowerName || lowerValue.startsWith(lowerName + ' ')) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if a revisedDate is a real historical date — not ADO's
 * `9999-01-01T00:00:00Z` sentinel (used to flag the current/not-yet-superseded
 * revision) and not any other implausibly-future date. Some responses include
 * a synthetic current-state entry with the sentinel revisedDate; if that entry
 * happens to carry a `System.AssignedTo` value we must not treat it as the
 * actual assignment event, or the stored timestamp ends up in the year 9999.
 */
function isRealRevisedDate(revisedDate) {
  const t = new Date(revisedDate).getTime();
  if (isNaN(t)) return false;
  // Anything more than a year ahead of "now" is treated as a sentinel.
  return t < Date.now() + 365 * 24 * 60 * 60 * 1000;
}

/**
 * Walks a work item's update history backward and finds the most recent
 * revision where `System.AssignedTo` was changed to the current user.
 *
 * @returns {{ revisedDate: string, revisedBy: Object } | null}
 */
function findAssignmentToUser(updates, currentUser) {
  // The /updates response is generally chronological, but sort defensively.
  // Filter out ADO's sentinel "current state" entry (revisedDate 9999-01-01)
  // before sorting — it would otherwise sort first by date and could carry a
  // synthetic System.AssignedTo value that fools the matcher.
  const sorted = updates
    .filter(u => isRealRevisedDate(u.revisedDate))
    .sort((a, b) => new Date(b.revisedDate) - new Date(a.revisedDate));

  for (const update of sorted) {
    const change = update.fields?.['System.AssignedTo'];
    if (!change) continue;
    if (!identityValueMatchesUser(change.newValue, currentUser)) continue;

    return {
      revisedDate: update.revisedDate,
      revisedBy: update.revisedBy,
    };
  }

  return null;
}

/**
 * Detects newly-assigned work items for the current user.
 *
 * Uses set-based diffing: compares the current "items assigned to me" set
 * against the set seen on the previous poll. Only items that newly entered
 * the set are candidates; their actual assignment date and assigner come
 * from the work item's revision history (System.AssignedTo change events),
 * not from System.ChangedDate / System.ChangedBy (which reflect any edit).
 *
 * @param {AdoApiClient} apiClient - Authenticated API client
 * @param {Object} currentUser - Current user info from apiClient.getCurrentUser()
 * @param {number[]|null} previousAssignedIds
 *   The set of work item IDs known to be assigned to the user as of the
 *   previous poll. `null` signals "no prior poll for this org" — in that
 *   case no notifications are produced; the current set is recorded so
 *   subsequent polls can diff against it.
 * @returns {Promise<{ assignments: Array, newAssignedIds: number[], warnings: string[] }>}
 */
export async function detectWorkItemAssignments(apiClient, currentUser, previousAssignedIds = null) {
  const warnings = [];

  // P1: broad WIQL, IDs only.
  const wiql = `
    SELECT [System.Id]
    FROM workitems
    WHERE [System.AssignedTo] = @Me
  `;

  let workItemRefs;
  try {
    workItemRefs = await apiClient.executeWiql(wiql);
  } catch (error) {
    console.error('Error querying assigned work items:', error);
    warnings.push(`Assignment query failed: ${error.message || 'WIQL error'}`);
    return {
      assignments: [],
      // On query failure, preserve whatever the caller already had so we don't
      // re-seed and miss real transitions on the next successful poll.
      newAssignedIds: previousAssignedIds || [],
      warnings,
    };
  }

  // P2: build current set.
  const currentIds = workItemRefs.map(wi => wi.id);

  // P3 + P4: first poll for this org → silent seed, no notifications.
  if (previousAssignedIds === null || previousAssignedIds === undefined) {
    return {
      assignments: [],
      newAssignedIds: currentIds,
      warnings,
    };
  }

  // P5: items in currentSet that were not in previousSet.
  const previousSet = new Set(previousAssignedIds);
  const addedIds = currentIds.filter(id => !previousSet.has(id));

  if (addedIds.length === 0) {
    return {
      assignments: [],
      newAssignedIds: currentIds,
      warnings,
    };
  }

  // P6: batch-fetch details for added IDs only.
  const addedWorkItems = [];
  for (let i = 0; i < addedIds.length; i += API_CONFIG.maxWorkItemsPerBatch) {
    const batchIds = addedIds.slice(i, i + API_CONFIG.maxWorkItemsPerBatch);
    try {
      const batchItems = await apiClient.getWorkItems(batchIds, [
        'System.Id',
        'System.Title',
        'System.TeamProject',
        'System.WorkItemType',
        // ChangedDate / ChangedBy are only used as a defensive fallback when
        // the revisions lookup can't identify an assignment-to-me event.
        'System.ChangedDate',
        'System.ChangedBy',
      ]);
      addedWorkItems.push(...batchItems);
    } catch (error) {
      console.error(`Error fetching new-assignment batch starting at ${batchIds[0]}:`, error);
      warnings.push(`Assignment batch #${batchIds[0]}: ${error.message || 'fetch failed'}`);
    }
  }

  // P7 + P8: for each added item, fetch revisions, identify the actual
  // assignment event, decide whether to notify, build the mention.
  const assignments = [];
  for (const workItem of addedWorkItems) {
    let revisedDate;
    let revisedBy;

    try {
      const updates = await apiClient.getWorkItemUpdates(workItem.id);
      const found = findAssignmentToUser(updates, currentUser);
      if (found) {
        revisedDate = found.revisedDate;
        revisedBy = found.revisedBy;
      } else {
        // P7c: shouldn't happen — WIQL says you're assigned, but the revisions
        // didn't show a transition to you. Fall back to the work item's most
        // recent edit so we still produce something usable.
        console.warn(`No assignment-to-me revision found for #${workItem.id}; falling back to ChangedDate/ChangedBy`);
        warnings.push(`Work item #${workItem.id}: no assignment revision found, using last-edit timestamp`);
        revisedDate = workItem.fields['System.ChangedDate'];
        revisedBy = workItem.fields['System.ChangedBy'];
      }
    } catch (error) {
      console.error(`Error fetching revisions for #${workItem.id}:`, error);
      warnings.push(`Revisions for #${workItem.id}: ${error.message || 'fetch failed'}`);
      revisedDate = workItem.fields['System.ChangedDate'];
      revisedBy = workItem.fields['System.ChangedBy'];
    }

    // P8a: skip self-assignment. Item is still tracked in newAssignedIds.
    if (revisedBy && (
      revisedBy.id === currentUser.id ||
      (revisedBy.uniqueName && currentUser.emailAddress &&
        revisedBy.uniqueName.toLowerCase() === currentUser.emailAddress.toLowerCase())
    )) {
      continue;
    }

    const mentionedBy = revisedBy ? {
      displayName: revisedBy.displayName || 'Unknown',
      uniqueName: revisedBy.uniqueName || '',
      imageUrl: revisedBy.imageUrl || null,
    } : {
      displayName: 'Unknown',
      uniqueName: '',
      imageUrl: null,
    };

    const projectName = workItem.fields['System.TeamProject'];
    assignments.push({
      // P8b: include revisedDate in the ID so a true reassignment after a gap
      // produces a new notification rather than colliding with a previous one.
      id: createMentionId(apiClient.orgUrl, 'workitem', workItem.id, `assignment:${revisedDate}`),
      orgUrl: apiClient.orgUrl,
      orgName: apiClient.orgName,
      type: 'workitem',
      subtype: 'assignment',
      itemId: workItem.id,
      itemTitle: workItem.fields['System.Title'],
      itemType: workItem.fields['System.WorkItemType'],
      projectName,
      repositoryName: null,
      commentId: null,
      commentHtml: null,
      commentPreview: 'You were assigned this work item',
      mentionedBy,
      timestamp: revisedDate,
      url: buildWorkItemCommentUrl(apiClient.orgUrl, projectName, workItem.id, null),
      userCommentedAfter: false,
      userReplyPreview: null,
    });
  }

  return {
    assignments,
    newAssignedIds: currentIds,
    warnings,
  };
}

/**
 * Extracts mentions from a single PR's comment threads.
 */
async function extractMentionsFromPR(apiClient, pr, currentUser, threadCache, cutoffTime) {
  const mentions = [];
  const projectName = pr.repository.project.name;
  const repositoryName = pr.repository.name;
  const repositoryId = pr.repository.id;
  const cachedMaxDate = threadCache[pr.pullRequestId] || null;

  let threads;
  try {
    threads = await apiClient.getPullRequestThreads(projectName, repositoryId, pr.pullRequestId);
  } catch (error) {
    console.error(`Error fetching threads for PR ${pr.pullRequestId}:`, error);
    return {
      mentions: [],
      maxDate: cachedMaxDate,
      warning: `PR #${pr.pullRequestId}: ${error.message || 'thread fetch failed'}`,
    };
  }

  let newMaxDate = cachedMaxDate;

  for (const thread of threads) {
    // Skip system threads (status changes, etc.)
    if (thread.isDeleted) continue;

    const threadLastUpdated = thread.lastUpdatedDate;

    // Track the max date for cache update
    if (!newMaxDate || threadLastUpdated > newMaxDate) {
      newMaxDate = threadLastUpdated;
    }

    // Skip threads older than our cache timestamp (optimization)
    if (cachedMaxDate && threadLastUpdated <= cachedMaxDate) {
      continue;
    }

    // Also skip threads older than cutoff time
    if (cutoffTime && new Date(threadLastUpdated).getTime() < cutoffTime) {
      continue;
    }

    const comments = thread.comments || [];

    for (const comment of comments) {
      // Skip deleted or system comments
      if (comment.isDeleted || comment.commentType === 'system') continue;

      // Check if this comment mentions the current user
      if (!commentMentionsUser(comment.content, currentUser)) continue;

      const mentionTimestamp = new Date(comment.publishedDate).getTime();

      // Find user's first reply after this mention
      let userCommentedAfter = false;
      let userReplyPreview = null;
      let earliestReplyTime = Infinity;

      for (const c of comments) {
        if (c.isDeleted || c.commentType === 'system') continue;
        const isUserComment = c.author?.id === currentUser.id ||
          c.author?.uniqueName?.toLowerCase() === currentUser.emailAddress?.toLowerCase();
        const commentTime = new Date(c.publishedDate).getTime();
        const isAfter = commentTime > mentionTimestamp;

        if (isUserComment && isAfter && commentTime < earliestReplyTime) {
          userCommentedAfter = true;
          earliestReplyTime = commentTime;
          userReplyPreview = extractPreview(c.content, 200);
        }
      }

      // Determine if this is a file comment
      const filePath = thread.threadContext?.filePath || null;
      const itemType = filePath ? 'PR File Comment' : 'PR Comment';

      mentions.push({
        id: createMentionId(apiClient.orgUrl, 'pullrequest', pr.pullRequestId, comment.id),
        orgUrl: apiClient.orgUrl,
        orgName: apiClient.orgName,
        type: 'pullrequest',
        subtype: 'mention',
        itemId: pr.pullRequestId,
        itemTitle: pr.title,
        itemType,
        projectName,
        repositoryName,
        commentId: comment.id,
        commentHtml: comment.content,
        commentPreview: extractPreview(comment.content),
        mentionedBy: {
          displayName: comment.author?.displayName || 'Unknown',
          uniqueName: comment.author?.uniqueName || '',
          imageUrl: comment.author?.imageUrl || null,
        },
        timestamp: comment.publishedDate,
        url: buildPRCommentUrl(apiClient.orgUrl, projectName, repositoryName, pr.pullRequestId, {
          filePath,
          isOverview: !filePath,
        }),
        userCommentedAfter,
        userReplyPreview,
      });
    }
  }

  return { mentions, maxDate: newMaxDate, warning: null };
}

/**
 * Checks if user is a reviewer on a PR and creates a partial notification object.
 * Returns null if user is not a reviewer or shouldn't be notified.
 * Caller must set id, orgUrl, orgName, and url fields.
 */
function checkReviewerAssignment(pr, currentUser, cutoffTime) {
  // Check if the PR was created after our cutoff
  const prCreatedTime = new Date(pr.creationDate).getTime();
  if (cutoffTime && prCreatedTime < cutoffTime) {
    return null;
  }

  // Find the user's reviewer entry (if any)
  const reviewers = pr.reviewers || [];
  const userReviewerEntry = reviewers.find(r =>
    r.id === currentUser.id ||
    r.uniqueName?.toLowerCase() === currentUser.emailAddress?.toLowerCase()
  );

  if (!userReviewerEntry) {
    return null;
  }

  // Skip if user is the PR author (they wouldn't add themselves as reviewer normally)
  if (pr.createdBy?.id === currentUser.id ||
      pr.createdBy?.uniqueName?.toLowerCase() === currentUser.emailAddress?.toLowerCase()) {
    return null;
  }

  const projectName = pr.repository.project.name;
  const repositoryName = pr.repository.name;
  const isRequired = userReviewerEntry.isRequired === true;
  const reviewerType = isRequired ? 'a required reviewer' : 'an optional reviewer';

  // Return partial object - caller will set id, orgUrl, orgName, and url
  return {
    type: 'pullrequest',
    subtype: 'assignment',
    itemId: pr.pullRequestId,
    itemTitle: pr.title,
    itemType: 'Pull Request',
    projectName,
    repositoryName,
    commentId: null,
    commentHtml: null,
    commentPreview: `You were added as ${reviewerType}`,
    mentionedBy: {
      displayName: pr.createdBy?.displayName || 'Unknown',
      uniqueName: pr.createdBy?.uniqueName || '',
      imageUrl: pr.createdBy?.imageUrl || null,
    },
    timestamp: pr.creationDate,
    userCommentedAfter: false,
    userReplyPreview: null,
  };
}

/**
 * Detects PR mentions and reviewer assignments.
 *
 * @param {AdoApiClient} apiClient - Authenticated API client
 * @param {Object} currentUser - Current user info from apiClient.getCurrentUser()
 * @param {Object} options - Detection options
 * @param {number} [options.lookbackMs] - Lookback time in ms for first run (default 2 days)
 * @param {string|null} [options.lastPRPollTime] - ISO timestamp of last PR poll
 * @param {Object} [options.threadCache] - { prId: maxLastUpdatedDate } map
 * @param {boolean} [options.includeReviewerAssignments] - Include reviewer assignment notifications
 * @returns {Promise<{mentions: Array, newLastPollTime: string, newThreadCache: Object}>}
 */
export async function detectPRMentions(apiClient, currentUser, options = {}) {
  const {
    lookbackMs = 7 * 24 * 60 * 60 * 1000, // 7 days
    lastPRPollTime = null,
    threadCache = {},
    includeReviewerAssignments = true,
  } = options;

  // Determine cutoff time
  let cutoffTime;
  if (lastPRPollTime) {
    cutoffTime = new Date(lastPRPollTime).getTime();
  } else {
    cutoffTime = Date.now() - lookbackMs;
  }

  // Get all projects
  let projects;
  const warnings = [];
  try {
    projects = await apiClient.listProjects();
  } catch (error) {
    console.error('Error listing projects:', error);
    warnings.push(`Failed to list projects: ${error.message || 'API error'}`);
    return { mentions: [], newLastPollTime: new Date().toISOString(), newThreadCache: threadCache, warnings };
  }

  const allMentions = [];
  const newThreadCache = { ...threadCache };
  const seenPRIds = new Set();

  // TODO: Projects are processed sequentially to avoid overwhelming the API.
  // For organizations with many projects, this may be slow. Consider:
  // 1. Parallel processing with concurrency limit (e.g., 3 projects at a time)
  // 2. Caching project list and only checking projects with recent PR activity
  // 3. Using a cross-project PR search if ADO API supports it
  for (const project of projects) {
    try {
      // Get PRs where user is a reviewer
      const reviewerPRs = await apiClient.getPullRequests(project.name, {
        reviewerId: currentUser.id,
        status: 'active',
      });

      // Get PRs where user is the author (to check for mentions in their own PRs)
      const authorPRs = await apiClient.getPullRequests(project.name, {
        creatorId: currentUser.id,
        status: 'active',
      });

      // Combine and dedupe PRs
      const prMap = new Map();
      for (const pr of [...reviewerPRs, ...authorPRs]) {
        prMap.set(pr.pullRequestId, pr);
      }

      for (const pr of prMap.values()) {
        seenPRIds.add(pr.pullRequestId);

        // Extract @mentions from PR threads
        const result = await extractMentionsFromPR(
          apiClient,
          pr,
          currentUser,
          threadCache,
          cutoffTime
        );

        allMentions.push(...result.mentions);

        // Collect warning if thread fetch failed
        if (result.warning) {
          warnings.push(result.warning);
        }

        // Update thread cache with new max date
        if (result.maxDate) {
          newThreadCache[pr.pullRequestId] = result.maxDate;
        }

        // Check for reviewer assignment
        if (includeReviewerAssignments) {
          const reviewerMention = checkReviewerAssignment(pr, currentUser, cutoffTime);
          if (reviewerMention) {
            // Complete the partial object with org-specific fields
            reviewerMention.id = createMentionId(apiClient.orgUrl, 'pullrequest', pr.pullRequestId, 'reviewer');
            reviewerMention.orgUrl = apiClient.orgUrl;
            reviewerMention.orgName = apiClient.orgName;
            reviewerMention.url = buildPRCommentUrl(
              apiClient.orgUrl,
              reviewerMention.projectName,
              reviewerMention.repositoryName,
              pr.pullRequestId,
              { isOverview: true }
            );
            allMentions.push(reviewerMention);
          }
        }
      }
    } catch (error) {
      console.error(`Error processing PRs for project ${project.name}:`, error);
      warnings.push(`Project ${project.name}: ${error.message || 'PR fetch failed'}`);
    }
  }

  // Clean up thread cache - remove entries for PRs not seen in this run
  // (they may have been completed/abandoned)
  for (const prId of Object.keys(newThreadCache)) {
    if (!seenPRIds.has(parseInt(prId, 10))) {
      delete newThreadCache[prId];
    }
  }

  return {
    mentions: allMentions,
    newLastPollTime: new Date().toISOString(),
    newThreadCache,
    warnings,
  };
}

/**
 * Main detection function - detects all mentions for an organization.
 *
 * @param {AdoApiClient} apiClient - Authenticated API client
 * @param {Object} options - Detection options
 * @param {boolean} [options.includeWorkItems=true] - Include work item mentions
 * @param {boolean} [options.includePRs=true] - Include PR mentions
 * @param {boolean} [options.includeAssignments=true] - Include assignments
 * @param {string|null} [options.lastPRPollTime] - ISO timestamp of last PR poll
 * @param {Object} [options.prThreadCache] - PR thread cache
 * @param {number[]|null} [options.previousAssignedIds]
 *   The set of work item IDs known to be assigned to the user as of the
 *   previous poll. `null` triggers a silent seed (no assignment notifications).
 * @returns {Promise<{
 *   mentions: Mention[],
 *   prResult: Object|null,
 *   assignmentResult: { newAssignedIds: number[] }|null,
 *   warnings: string[]
 * }>}
 */
export async function detectMentions(apiClient, options = {}) {
  const {
    includeWorkItems = true,
    includePRs = true,
    includeAssignments = true,
    lastPRPollTime = null,
    prThreadCache = {},
    previousAssignedIds = null,
  } = options;

  // Get current user once and pass to all detection functions
  const currentUser = await apiClient.getCurrentUser();

  const allMentions = [];
  const allWarnings = [];
  let prResult = null;
  let assignmentResult = null;

  // Work item @mentions (uses @recentMentions WIQL)
  if (includeWorkItems) {
    const wiResult = await detectWorkItemMentions(apiClient, currentUser);
    allMentions.push(...wiResult.mentions);
    allWarnings.push(...wiResult.warnings);
  }

  // Work item assignments (set-based diff over the user's currently-assigned
  // items, with revisions used to identify the actual assignment event).
  if (includeAssignments) {
    const assignResult = await detectWorkItemAssignments(apiClient, currentUser, previousAssignedIds);
    allMentions.push(...assignResult.assignments);
    allWarnings.push(...assignResult.warnings);
    assignmentResult = { newAssignedIds: assignResult.newAssignedIds };
  }

  // PR @mentions and reviewer assignments
  if (includePRs) {
    prResult = await detectPRMentions(apiClient, currentUser, {
      lastPRPollTime,
      threadCache: prThreadCache,
      includeReviewerAssignments: includeAssignments,
    });
    allMentions.push(...prResult.mentions);
    allWarnings.push(...prResult.warnings);
  }

  // Deduplicate by ID (safety measure)
  const seen = new Set();
  const dedupedMentions = allMentions.filter(m => {
    if (seen.has(m.id)) {
      return false;
    }
    seen.add(m.id);
    return true;
  });

  return {
    mentions: dedupedMentions,
    prResult,
    assignmentResult,
    warnings: allWarnings,
  };
}
