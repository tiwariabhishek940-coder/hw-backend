require('dotenv').config();
const app   = require('./src/app');
const { pool } = require('./src/config/db');
const redis = require('./src/config/redis');

const PORT = process.env.PORT || 4000;

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('✅  PostgreSQL connected');

    await redis.connect();

    const server = app.listen(PORT, () => {
      console.log(`🚀  Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });

    const shutdown = async (signal) => {
      console.log(`\n${signal} received — shutting down gracefully`);
      server.close(async () => {
        await pool.end();
        await redis.quit();
        process.exit(0);
      });
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
