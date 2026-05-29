/**
 * Shared schema definitions used by both main and renderer (informational).
 * Currently only used as reference; data is stored as raw JSON.
 */

'use strict';

/**
 * @typedef {Object} Subtask
 * @property {string} id
 * @property {string} title
 * @property {boolean} done
 */

/**
 * @typedef {Object} Task
 * @property {string} id
 * @property {string} title
 * @property {'plan'|'temp'|'daily'} type
 * @property {'todo'|'doing'|'suspended'|'done'} status
 * @property {number} priority
 * @property {string} context
 * @property {number|null} suspendedAt
 * @property {number|null} doingStartAt
 * @property {number|null} doneAt
 * @property {Subtask[]} subtasks
 * @property {string|null} aiHint
 * @property {boolean} aiHintDismissed
 * @property {number} createdAt
 * @property {number|null} calHour
 * @property {number} durationHours
 */

/**
 * @typedef {Object} Workspace
 * @property {Task[]} tasks
 * @property {string[]} notifiedOverdueIds
 * @property {string[]} expandedSubtaskIds
 * @property {number} aiNavCooldownUntil
 * @property {string|null} aiNavMessage
 */

/**
 * @typedef {Object} Journal
 * @property {string} id           - 'j' + base36 timestamp
 * @property {string} date         - 'YYYY-MM-DD'
 * @property {'work'|'life'} ws
 * @property {number|null} mood    - 1..5
 * @property {string} note
 * @property {number} doneCount
 * @property {number} undoneCount
 * @property {Array<Object>} done
 * @property {Array<Object>} undone
 */

module.exports = {};
