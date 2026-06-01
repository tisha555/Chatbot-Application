const { createClient } = require('redis');
const { initDb } = require('./db');
const { processLog } = require('./processor');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

async function startWorker() {
  console.log('Worker service starting...');
  
  // 1. Initialize Database
  let dbConnected = false;
  while (!dbConnected) {
    try {
      await initDb();
      dbConnected = true;
    } catch (err) {
      console.error('Database connection failed, retrying in 5 seconds...', err.message);
      await new Promise(res => setTimeout(res, 5000));
    }
  }

  // 2. Connect to Redis
  const redisClient = createClient({ url: redisUrl });
  redisClient.on('error', (err) => console.error('Redis Client Error', err));

  try {
    await redisClient.connect();
    console.log('Connected to Redis at:', redisUrl);
  } catch (err) {
    console.error('Failed to connect to Redis. Exiting...', err);
    process.exit(1);
  }

  const QUEUE_NAME = 'llm-logs-queue';
  console.log(`Listening for inference logs on Redis queue: "${QUEUE_NAME}"...`);

  // 3. Worker Event Loop
  while (true) {
    try {
      // blPop blocks until an item is available in the list.
      // The array response has format [key, value]
      const result = await redisClient.blPop(QUEUE_NAME, 0); // timeout=0 means block indefinitely
      
      if (result) {
        const payload = JSON.parse(result.element);
        console.log(`Received log event: ${payload.logId || 'no-id'}`);
        
        await processLog(payload);
      }
    } catch (error) {
      console.error('Error in worker processing loop:', error);
      // Wait a moment to prevent tight loop on persistent failures
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

startWorker();
