/**
 * Unified database connector with Postgres connection pool and an in-memory fallback.
 */
const { Pool } = require('pg');
const crypto = require('crypto');

const databaseUrl = process.env.DATABASE_URL;
let pgPool = null;
let useFallback = false;

// In-Memory Database Fallback for local-host testing without Postgres
const memoryDb = {
  conversations: {},
  messages: {},
  inferenceLogs: {},
  extractedMetadata: {}
};

async function initDatabase() {
  if (!databaseUrl) {
    console.log('No DATABASE_URL provided. Operating in-memory fallback mode.');
    useFallback = true;
    return;
  }

  pgPool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000
  });

  try {
    // Try to connect to verify db presence
    const client = await pgPool.connect();
    client.release();
    console.log('Chatbot app successfully connected to PostgreSQL.');
  } catch (err) {
    console.warn('Could not connect to PostgreSQL. Falling back to in-memory mode.', err.message);
    useFallback = true;
  }
}

// Ensure database is initialized
initDatabase();

module.exports = {
  // 1. Conversations
  async getConversations() {
    if (useFallback) {
      return Object.values(memoryDb.conversations).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    const res = await pgPool.query('SELECT * FROM conversations ORDER BY created_at DESC');
    return res.rows;
  },

  async createConversation(id, title) {
    const newConv = {
      id,
      title,
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (useFallback) {
      memoryDb.conversations[id] = newConv;
      return newConv;
    }
    await pgPool.query(
      'INSERT INTO conversations (id, title, status) VALUES ($1, $2, $3)',
      [id, title, 'active']
    );
    return newConv;
  },

  async updateConversationStatus(id, status) {
    if (useFallback) {
      if (memoryDb.conversations[id]) {
        memoryDb.conversations[id].status = status;
        memoryDb.conversations[id].updated_at = new Date().toISOString();
      }
      return;
    }
    await pgPool.query(
      'UPDATE conversations SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id]
    );
  },

  async deleteConversation(id) {
    if (useFallback) {
      delete memoryDb.conversations[id];
      // clean cascading messages
      for (const msgId in memoryDb.messages) {
        if (memoryDb.messages[msgId].conversation_id === id) {
          delete memoryDb.messages[msgId];
        }
      }
      return;
    }
    await pgPool.query('DELETE FROM conversations WHERE id = $1', [id]);
  },

  // 2. Messages
  async getMessages(conversationId) {
    if (useFallback) {
      return Object.values(memoryDb.messages)
        .filter(m => m.conversation_id === conversationId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    const res = await pgPool.query(
      'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conversationId]
    );
    return res.rows;
  },

  async saveMessage(id, conversationId, role, content) {
    const newMsg = {
      id,
      conversation_id: conversationId,
      role,
      content,
      created_at: new Date().toISOString()
    };
    if (useFallback) {
      memoryDb.messages[id] = newMsg;
      return newMsg;
    }
    await pgPool.query(
      'INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)',
      [id, conversationId, role, content]
    );
    return newMsg;
  },

  // 3. Dashboard Metrics Endpoint
  async getMetrics() {
    if (useFallback) {
      // In Memory metrics compilation for mock fallback
      const logs = Object.values(memoryDb.inferenceLogs);
      const metas = Object.values(memoryDb.extractedMetadata);
      
      const totalRequests = logs.length;
      const errors = logs.filter(l => l.status_code >= 400).length;
      const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0.0;
      
      const totalLatency = logs.reduce((sum, l) => sum + l.latency_ms, 0);
      const avgLatency = totalRequests > 0 ? totalLatency / totalRequests : 0;
      
      const totalTokens = logs.reduce((sum, l) => sum + (l.input_tokens || 0) + (l.output_tokens || 0), 0);
      const totalCost = metas.reduce((sum, m) => sum + Number(m.cost_usd || 0), 0);
      
      const totalRedactions = metas.reduce((sum, m) => sum + (m.pii_redacted_count || 0), 0);
      
      // Recent logs (last 20) joined with metadata
      const recentLogs = logs.map(log => {
        const meta = metas.find(m => m.inference_log_id === log.id) || {};
        return {
          ...log,
          cost_usd: meta.cost_usd || 0.0,
          throughput_tps: meta.throughput_tps || 0.0,
          pii_redacted_count: meta.pii_redacted_count || 0
        };
      }).sort((a, b) => new Date(b.request_timestamp) - new Date(a.request_timestamp)).slice(0, 20);

      // Model breakdown
      const modelCounts = {};
      logs.forEach(l => {
        modelCounts[l.model] = (modelCounts[l.model] || 0) + 1;
      });

      return {
        summary: {
          total_requests: totalRequests,
          avg_latency_ms: Math.round(avgLatency),
          error_rate: Math.round(errorRate * 10) / 10,
          total_tokens: totalTokens,
          total_cost_usd: Math.round(totalCost * 10000) / 10000,
          total_pii_redactions: totalRedactions
        },
        modelBreakdown: modelCounts,
        recentLogs
      };
    }

    // PostgreSQL Queries
    const summaryQuery = `
      SELECT 
        COUNT(*)::int as total_requests,
        COALESCE(AVG(latency_ms), 0)::int as avg_latency_ms,
        COALESCE((COUNT(CASE WHEN status_code >= 400 THEN 1 END)::float / NULLIF(COUNT(*), 0)) * 100, 0) as error_rate,
        COALESCE(SUM(input_tokens + output_tokens), 0)::int as total_tokens
      FROM inference_logs;
    `;
    
    const metaSummaryQuery = `
      SELECT 
        COALESCE(SUM(cost_usd), 0)::float as total_cost_usd,
        COALESCE(SUM(pii_redacted_count), 0)::int as total_pii_redactions
      FROM extracted_metadata;
    `;

    const modelBreakdownQuery = `
      SELECT model, COUNT(*)::int as count 
      FROM inference_logs 
      GROUP BY model;
    `;

    const recentLogsQuery = `
      SELECT 
        l.id, l.conversation_id, l.model, l.provider, l.latency_ms, 
        l.input_tokens, l.output_tokens, l.status_code, l.error_message, 
        l.request_timestamp, l.response_timestamp,
        m.cost_usd::float, m.throughput_tps::float, m.pii_redacted_count
      FROM inference_logs l
      LEFT JOIN extracted_metadata m ON l.id = m.inference_log_id
      ORDER BY l.request_timestamp DESC
      LIMIT 20;
    `;

    const [summaryRes, metaRes, modelRes, logsRes] = await Promise.all([
      pgPool.query(summaryQuery),
      pgPool.query(metaSummaryQuery),
      pgPool.query(modelBreakdownQuery),
      pgPool.query(recentLogsQuery)
    ]);

    const summary = {
      ...summaryRes.rows[0],
      ...metaRes.rows[0]
    };

    // Format model breakdown
    const modelBreakdown = {};
    modelRes.rows.forEach(row => {
      modelBreakdown[row.model] = row.count;
    });

    return {
      summary,
      modelBreakdown,
      recentLogs: logsRes.rows
    };
  },

  // Save log payload directly in fallback mode
  // The worker process saves them in postgres mode.
  // If fallback is on, the ingestion service is bypassed or worker isn't running,
  // so the Chatbot app writes log events directly to its memory database to simulate ingestion!
  saveFallbackLog(logPayload) {
    if (!useFallback) return;
    const { logId } = logPayload;
    memoryDb.inferenceLogs[logId] = logPayload;

    // Simulate Worker extracting metadata and storing
    const pricing = {
      'gemini-1.5-flash': { input: 0.075, output: 0.30 },
      'gemini-1.5-pro': { input: 1.25, output: 5.00 },
      'gemini-2.0-flash-exp': { input: 0.075, output: 0.30 },
      'gpt-4o': { input: 5.00, output: 15.00 },
      'gpt-4o-mini': { input: 0.150, output: 0.600 },
      'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
      'claude-3-5-sonnet': { input: 3.00, output: 15.00 },
      'claude-3-haiku': { input: 0.25, output: 1.25 },
      'mock-llm': { input: 0.10, output: 0.40 }
    };
    
    let cost = 0.0;
    const modelLower = (logPayload.model || '').toLowerCase();
    let price = { input: 0.10, output: 0.40 };
    for (const [key, val] of Object.entries(pricing)) {
      if (modelLower.includes(key)) {
        price = val;
        break;
      }
    }
    cost = ((logPayload.inputTokens || 0) / 1000000) * price.input + 
           ((logPayload.outputTokens || 0) / 1000000) * price.output;
           
    const latencySec = (logPayload.latencyMs || 0) / 1000;
    const tps = latencySec > 0 ? (logPayload.outputTokens || 0) / latencySec : 0;

    const redactionPattern = /\[REDACTED_(EMAIL|PHONE|CARD)\]/g;
    const totalRedactions = ((logPayload.inputPreview || '').match(redactionPattern) || []).length +
                            ((logPayload.outputPreview || '').match(redactionPattern) || []).length;

    memoryDb.extractedMetadata[crypto.randomUUID()] = {
      inference_log_id: logId,
      cost_usd: cost,
      throughput_tps: tps,
      client_ip: '127.0.0.1',
      user_agent: 'Local Fallback Client',
      pii_redacted_count: totalRedactions,
      created_at: new Date().toISOString()
    };
  }
};
