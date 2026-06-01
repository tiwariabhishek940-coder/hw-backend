const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

redis.on('connect',  () => console.log('Redis connected'));
redis.on('error',    (e) => console.error('Redis error:', e.message));

module.exports = redis;
