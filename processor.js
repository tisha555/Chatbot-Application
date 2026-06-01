const crypto = require('crypto');
const { pool } = require('./db');

// Model pricing per 1,000,000 tokens (approx USD)
const MODEL_PRICING = {
  // Gemini
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-2.0-flash-exp': { input: 0.075, output: 0.30 },
  // OpenAI
  'gpt-4o': { input: 5.00, output: 15.00 },
  'gpt-4o-mini': { input: 0.150, output: 0.600 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  // Anthropic
  'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  // Mock LLM
  'mock-llm': { input: 0.10, output: 0.40 }
};

function getPricing(model) {
  const normalized = model.toLowerCase();
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (normalized.includes(key)) {
      return price;
    }
  }
  return { input: 0.10, output: 0.40 }; // default mock pricing
}

async function processLog(logEvent) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const {
      logId = crypto.randomUUID(),
      conversationId,
      messageId,
      model = 'unknown',
      provider = 'unknown',
      latencyMs = 0,
      inputTokens = 0,
      outputTokens = 0,
      statusCode = 200,
      errorMessage = null,
      requestTimestamp,
      responseTimestamp,
      inputPreview = '',
      outputPreview = '',
      clientIp = '',
      userAgent = '',
      rawPayload = {}
    } = logEvent;

    // 1. Double check conversation exists. If not, insert placeholder so Postgres FK constraints pass.
    if (conversationId) {
      const convCheck = await client.query('SELECT id FROM conversations WHERE id = $1', [conversationId]);
      if (convCheck.rows.length === 0) {
        await client.query(
          'INSERT INTO conversations (id, title, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
          [conversationId, 'Restored Chat Session', 'active']
        );
      }
    }

    // 2. Double check message exists. If messageId is provided but not in DB, create it.
    if (messageId && conversationId) {
      const msgCheck = await client.query('SELECT id FROM messages WHERE id = $1', [messageId]);
      if (msgCheck.rows.length === 0) {
        await client.query(
          'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
          [messageId, conversationId, 'assistant', outputPreview]
        );
      }
    }

    // 3. Insert Inference Log
    const insertLogQuery = `
      INSERT INTO inference_logs (
        id, conversation_id, message_id, model, provider, latency_ms,
        input_tokens, output_tokens, status_code, error_message,
        request_timestamp, response_timestamp, raw_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO NOTHING
    `;
    await client.query(insertLogQuery, [
      logId,
      conversationId || null,
      messageId || null,
      model,
      provider,
      latencyMs,
      inputTokens,
      outputTokens,
      statusCode,
      errorMessage,
      new Date(requestTimestamp),
      new Date(responseTimestamp),
      JSON.stringify(rawPayload)
    ]);

    // 4. Calculate Costs
    const pricing = getPricing(model);
    const costInput = (inputTokens / 1000000) * pricing.input;
    const costOutput = (outputTokens / 1000000) * pricing.output;
    const totalCost = costInput + costOutput;

    // 5. Calculate Throughput (Tokens per second)
    const latencySec = latencyMs / 1000;
    const throughputTps = latencySec > 0 ? (outputTokens / latencySec) : 0;

    // 6. Calculate PII Redacted Occurrences
    const redactionPattern = /\[REDACTED_(EMAIL|PHONE|CARD)\]/g;
    const redactedInInput = (inputPreview.match(redactionPattern) || []).length;
    const redactedInOutput = (outputPreview.match(redactionPattern) || []).length;
    const totalRedactions = redactedInInput + redactedInOutput;

    // 7. Insert Extracted Metadata
    const metadataId = crypto.randomUUID();
    const insertMetaQuery = `
      INSERT INTO extracted_metadata (
        id, inference_log_id, cost_usd, throughput_tps, client_ip, user_agent, pii_redacted_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO NOTHING
    `;
    await client.query(insertMetaQuery, [
      metadataId,
      logId,
      totalCost,
      throughputTps,
      clientIp,
      userAgent,
      totalRedactions
    ]);

    await client.query('COMMIT');
    console.log(`Successfully processed and saved log ${logId} for conversation ${conversationId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing log event:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  processLog,
};
