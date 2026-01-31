const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

const defaultQueue = new Queue('default', { connection });
const highQueue = new Queue('high_priority', { connection });

module.exports = {
  defaultQueue,
  highQueue,
  connection,
};
