const crypto = require('crypto');
const { redactPII } = require('./pii');

const INGESTION_URL = process.env.INGESTION_URL || 'http://localhost:3001/api/logs';

/**
 * Estimates token counts based on a word-ratio if the API doesn't provide them.
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  return Math.max(1, Math.ceil(words * 1.33));
}

/**
 * Asynchronously post logs to the ingestion pipeline.
 * Runs in the background and falls back to local storage if API is unreachable.
 */
function sendLogToIngestion(logPayload) {
  const body = JSON.stringify(logPayload);
  
  // Require dbConnector dynamically to avoid circular dependencies
  const dbConnector = require('../dbConnector');
  
  fetch(INGESTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        console.error(`Ingestion pipeline rejected log: ${res.status} - ${text}`);
        dbConnector.saveFallbackLog(logPayload);
      }
    })
    .catch((err) => {
      // In-memory fallback
      dbConnector.saveFallbackLog(logPayload);
    });
}

/**
 * Wraps an LLM call to record performance metrics, tokens, PII redaction, and log results.
 */
async function wrapLLMCall(apiCallFn, args, metadata) {
  const { conversationId, messageId, model, provider, inputText, streaming = false } = metadata;
  
  const logId = crypto.randomUUID();
  const requestTimestamp = new Date().toISOString();
  const startTime = process.hrtime.bigint();

  // 1. Redact input prompt PII
  const { redactedText: redactedInput, count: redactedInputCount } = redactPII(inputText);

  if (streaming) {
    try {
      const stream = await apiCallFn(...args);
      
      return (async function* () {
        let fullOutputText = '';
        let chunkCount = 0;
        let finalStatusCode = 200;
        let finalError = null;

        try {
          for await (const chunk of stream) {
            const textChunk = typeof chunk === 'string' ? chunk : (chunk.text || '');
            fullOutputText += textChunk;
            chunkCount++;
            yield chunk;
          }
        } catch (streamErr) {
          finalStatusCode = 500;
          finalError = streamErr.message || 'Stream error occurred';
          throw streamErr;
        } finally {
          const endTime = process.hrtime.bigint();
          const responseTimestamp = new Date().toISOString();
          const latencyMs = Number(endTime - startTime) / 1e6;

          const { redactedText: redactedOutput, count: redactedOutputCount } = redactPII(fullOutputText);
          const inputTokens = estimateTokens(redactedInput);
          const outputTokens = estimateTokens(redactedOutput);

          const logPayload = {
            logId,
            conversationId,
            messageId,
            model,
            provider,
            latencyMs: Math.round(latencyMs),
            inputTokens,
            outputTokens,
            statusCode: finalStatusCode,
            errorMessage: finalError,
            requestTimestamp,
            responseTimestamp,
            inputPreview: redactedInput.substring(0, 1000),
            outputPreview: redactedOutput.substring(0, 1000),
            rawPayload: {
              request: { model, provider, messages: [{ role: 'user', content: redactedInput }], streaming: true },
              response: { status: finalStatusCode === 200 ? 'success' : 'error', chunks_received: chunkCount, choices: [{ message: { role: 'assistant', content: redactedOutput } }] }
            }
          };

          sendLogToIngestion(logPayload);
        }
      })();
    } catch (err) {
      const endTime = process.hrtime.bigint();
      const responseTimestamp = new Date().toISOString();
      const latencyMs = Number(endTime - startTime) / 1e6;

      const logPayload = {
        logId,
        conversationId,
        messageId,
        model,
        provider,
        latencyMs: Math.round(latencyMs),
        inputTokens: estimateTokens(redactedInput),
        outputTokens: 0,
        statusCode: 500,
        errorMessage: err.message || 'Failed to initialize stream',
        requestTimestamp,
        responseTimestamp,
        inputPreview: redactedInput.substring(0, 1000),
        outputPreview: '',
        rawPayload: {
          request: { model, provider, messages: [{ role: 'user', content: redactedInput }] },
          response: { error: err.message }
        }
      };

      sendLogToIngestion(logPayload);
      throw err;
    }
  } else {
    try {
      const response = await apiCallFn(...args);
      
      const endTime = process.hrtime.bigint();
      const responseTimestamp = new Date().toISOString();
      const latencyMs = Number(endTime - startTime) / 1e6;

      const rawOutputText = response.text || response.choices?.[0]?.message?.content || '';
      const { redactedText: redactedOutput, count: redactedOutputCount } = redactPII(rawOutputText);

      const inputTokens = response.usage?.prompt_tokens || estimateTokens(redactedInput);
      const outputTokens = response.usage?.completion_tokens || estimateTokens(redactedOutput);

      const logPayload = {
        logId,
        conversationId,
        messageId,
        model,
        provider,
        latencyMs: Math.round(latencyMs),
        inputTokens,
        outputTokens,
        statusCode: 200,
        errorMessage: null,
        requestTimestamp,
        responseTimestamp,
        inputPreview: redactedInput.substring(0, 1000),
        outputPreview: redactedOutput.substring(0, 1000),
        rawPayload: {
          request: { model, provider, messages: [{ role: 'user', content: redactedInput }] },
          response: { status: 'success', raw: response }
        }
      };

      sendLogToIngestion(logPayload);
      return response;
    } catch (err) {
      const endTime = process.hrtime.bigint();
      const responseTimestamp = new Date().toISOString();
      const latencyMs = Number(endTime - startTime) / 1e6;

      const logPayload = {
        logId,
        conversationId,
        messageId,
        model,
        provider,
        latencyMs: Math.round(latencyMs),
        inputTokens: estimateTokens(redactedInput),
        outputTokens: 0,
        statusCode: err.statusCode || 500,
        errorMessage: err.message || 'API error',
        requestTimestamp,
        responseTimestamp,
        inputPreview: redactedInput.substring(0, 1000),
        outputPreview: '',
        rawPayload: {
          request: { model, provider, messages: [{ role: 'user', content: redactedInput }] },
          response: { error: err.message }
        }
      };

      sendLogToIngestion(logPayload);
      throw err;
    }
  }
}

module.exports = {
  wrapLLMCall
};
