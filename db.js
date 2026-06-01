const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/inference_db';

const pool = new Pool({
  connectionString: databaseUrl,
});

async function initDb() {
  const client = await pool.connect();
  try {
    console.log('Initializing database schema...');
    
    // Create Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY,
        conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inference_logs (
        id UUID PRIMARY KEY,
        conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
        message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
        model VARCHAR(100) NOT NULL,
        provider VARCHAR(100) NOT NULL,
        latency_ms INT NOT NULL,
        input_tokens INT,
        output_tokens INT,
        status_code INT NOT NULL,
        error_message TEXT,
        request_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        response_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
        raw_payload JSONB
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS extracted_metadata (
        id UUID PRIMARY KEY,
        inference_log_id UUID REFERENCES inference_logs(id) ON DELETE CASCADE,
        cost_usd NUMERIC(10, 6) DEFAULT 0.0,
        throughput_tps NUMERIC(10, 2) DEFAULT 0.0,
        client_ip VARCHAR(45),
        user_agent TEXT,
        pii_redacted_count INT DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database schema initialized successfully.');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDb,
};
