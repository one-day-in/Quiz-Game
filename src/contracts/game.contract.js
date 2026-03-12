// shared/contracts/game.contract.js

/**
 * @typedef {Object} Media
 * @property {string} filename - filename only, no path
 * @property {string} url - URL to access the file
 * @property {string} mime - MIME type
 * @property {number} size - size in bytes
 */

/**
 * @typedef {Object} Question
 * @property {string} text - question text (max 1000 chars)
 * @property {Media|null} media - media file or null
 */

/**
 * @typedef {Object} Answer
 * @property {string} text - answer text (max 1000 chars)
 * @property {Media|null} media - media file or null
 */

/**
 * @typedef {Object} Cell
 * @property {boolean} isAnswered
 * @property {Question} question
 * @property {Answer} answer
 */

/**
 * @typedef {Object} Row
 * @property {string} topic - topic name (max 200 chars)
 * @property {Cell[]} cells - array of 5 cells
 */

/**
 * @typedef {Object} Round
 * @property {Row[]} rows - array of 5 rows
 */

/**
 * @typedef {Object} GameMeta
 * @property {string} updatedAt - ISO date of last update
 */

/**
 * @typedef {Object} Game
 * @property {string} schemaVersion
 * @property {GameMeta} meta
 * @property {Round[]} rounds - array of 3 rounds
 */

/**
 * Check if an object is a valid Media object
 */
export function isMedia(obj) {
    if (!obj || typeof obj !== 'object') return false;

    // 1. Check filename
    if (typeof obj.filename !== 'string') return false;
    if (obj.filename.length === 0 || obj.filename.length > 255) return false;
    if (obj.filename.includes('/') || obj.filename.includes('\\') || obj.filename.includes('..')) return false;

    // 2. Check URL — must be a valid path (relative or absolute)
    if (typeof obj.url !== 'string') return false;
    if (!obj.url.startsWith('/') && !obj.url.startsWith('http')) return false;

    // 3. Check mime
    if (typeof obj.mime !== 'string' || obj.mime.length === 0) return false;

    // 4. Check size
    if (typeof obj.size !== 'number' || obj.size < 0 || obj.size > 100 * 1024 * 1024) return false;

    return true;
}

/**
 * Check if an object is a valid question or answer
 */
function isQuestionOrAnswer(obj) {
    return obj
        && typeof obj === 'object'
        && typeof obj.text === 'string'
        && obj.text.length <= 1000
        && (obj.media === null || isMedia(obj.media));
}

/**
 * Check if an object is a valid cell
 */
export function isCell(obj) {
    return obj
        && typeof obj === 'object'
        && typeof obj.isAnswered === 'boolean'
        && isQuestionOrAnswer(obj.question)
        && isQuestionOrAnswer(obj.answer);
}

/**
 * Check if an object is a valid row (topic)
 */
function isRow(obj) {
    return obj
        && typeof obj === 'object'
        && typeof obj.topic === 'string'
        && obj.topic.length <= 200
        && Array.isArray(obj.cells)
        && obj.cells.length === 5
        && obj.cells.every(isCell);
}

/**
 * Check if an object is a valid round
 */
function isRound(obj) {
    return obj
        && typeof obj === 'object'
        && Array.isArray(obj.rows)
        && obj.rows.length === 5
        && obj.rows.every(isRow);
}

/**
 * Full game validation
 */
export function isGame(obj) {
    return obj
        && typeof obj === 'object'
        && typeof obj.schemaVersion === 'string'
        && obj.schemaVersion.length > 0
        && obj.meta && typeof obj.meta === 'object'
        && typeof obj.meta.updatedAt === 'string'
        && !isNaN(Date.parse(obj.meta.updatedAt))
        && Array.isArray(obj.rounds)
        && obj.rounds.length === 3
        && obj.rounds.every(isRound);
}

// Validation constants
export const VALIDATION = {
    MAX_TOPIC_LENGTH: 200,
    MAX_TEXT_LENGTH: 1000,
    MAX_FILENAME_LENGTH: 255,
    MAX_FILE_SIZE: 200 * 1024 * 1024,
    ALLOWED_MIME_PREFIXES: ['image/', 'audio/', 'video/']
};
