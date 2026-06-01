/**
 * Simple Regex-based PII Redaction utility
 */

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Matches US and simple international formats: e.g. +1-123-456-7890, 123-456-7890, (123) 456 7890
const PHONE_REGEX = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

// Matches standard 13-16 digit credit card numbers, possibly containing spaces or hyphens
const CREDIT_CARD_REGEX = /\b(?:\d[ -]*?){13,16}\b/g;

/**
 * Redacts PII from text
 * @param {string} text The raw text content
 * @returns {Object} { redactedText, count }
 */
function redactPII(text) {
  if (!text || typeof text !== 'string') {
    return { redactedText: text, count: 0 };
  }

  let count = 0;
  let redactedText = text;

  // 1. Redact Emails
  const emails = text.match(EMAIL_REGEX);
  if (emails) {
    count += emails.length;
    redactedText = redactedText.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
  }

  // 2. Redact Phone Numbers
  const phones = text.match(PHONE_REGEX);
  if (phones) {
    count += phones.length;
    redactedText = redactedText.replace(PHONE_REGEX, '[REDACTED_PHONE]');
  }

  // 3. Redact Credit Cards
  const cards = text.match(CREDIT_CARD_REGEX);
  if (cards) {
    // Run validation on card length to reduce false positives
    count += cards.length;
    redactedText = redactedText.replace(CREDIT_CARD_REGEX, '[REDACTED_CARD]');
  }

  return {
    redactedText,
    count
  };
}

module.exports = {
  redactPII
};
