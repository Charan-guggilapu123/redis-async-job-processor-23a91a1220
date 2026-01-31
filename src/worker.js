const { Worker } = require('bullmq');
const { Parser } = require('json2csv');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const IORedis = require('ioredis');
require('dotenv').config();

const redisConnection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

// Mail transporter
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || 'mailhog',
  port: parseInt(process.env.MAIL_PORT || '1025'),
  ignoreTLS: true,
});

async function processJob(job) {
  const { jobId, type, payload } = job.data;
  const attemptNumber = job.attemptsMade + 1;

  console.log(JSON.stringify({
    level: 'info',
    message: 'Starting job',
    jobId,
    jobType: type,
    attemptNumber,
    timestamp: new Date().toISOString()
  }));
  
  // Update DB: Processing & Increment Attempts
  try {
    // attemptsMade starts at 0. So attempt #1 is attemptsMade 0 + 1.
    await db.query(`
      UPDATE jobs 
      SET status = 'processing', 
          attempts = $2, 
          updated_at = NOW() 
      WHERE id = $1
    `, [jobId, attemptNumber]);
  } catch (dbErr) {
    console.error(JSON.stringify({
      level: 'error',
      message: 'Failed to update job status',
      jobId,
      error: dbErr.message
    }));
  }

  let resultData = null;

  if (type === 'CSV_EXPORT') {
    if (!payload.data || !Array.isArray(payload.data) || payload.data.length === 0) {
        // Handle empty or invalid data? 
        // Just create empty CSV or throw?
        // IF empty, the parser might throw or produce empty.
    }
    const data = payload.data;
    // Handle empty data case gracefully or let parser handle it
    const fields = data.length > 0 ? Object.keys(data[0]) : [];
    const parser = new Parser({ fields });
    const csv = parser.parse(data);
    const fileName = `${jobId}.csv`;
    const outputDir = path.join('/usr/src/app/output');
    const filePath = path.join(outputDir, fileName);
    
    // Ensure output dir exists
    if (!fs.existsSync(outputDir)){
        fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(filePath, csv);
    resultData = { filePath };
  } else if (type === 'EMAIL_SEND') {
    const { to, subject, body } = payload;
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM || 'noreply@example.com',
      to,
      subject,
      text: body,
    });
    resultData = { messageId: info.messageId };
  } else {
    throw new Error(`Unknown job type: ${type}`);
  }

  return resultData;
}

const workerHandler = async (job) => {
    return await processJob(job);
};

const workerOptions = { 
    connection: redisConnection,
    concurrency: 1 
};

// Instantiate workers
const highWorker = new Worker('high_priority', workerHandler, workerOptions);
const defaultWorker = new Worker('default', workerHandler, workerOptions);

// Event listeners for DB updates

const handleCompleted = async (job, result) => {
    const { jobId } = job.data;
    try {
        await db.query(`
            UPDATE jobs 
            SET status = 'completed', 
                result = $2, 
                updated_at = NOW() 
            WHERE id = $1
        `, [jobId, result]);
        console.log(`Job ${jobId} completed`);
    } catch (e) {
        console.error(`Error completing job ${jobId}`, e);
    }
};

const handleFailed = async (job, err) => {
    const { jobId } = job.data;
    console.log(`Job ${jobId} failed with ${err.message}. Attempts: ${job.attemptsMade}`);
    
    // Check if permanently failed (retries exhausted)
    // BullMQ moves to 'failed' status only when retries are exhausted.
    // So if this event handler is called, it usually means it's done retrying (unless we are manually listening to 'error' or similar).
    // Wait, on 'failed' event, check if attemptsMade >= opts.attempts
    
    // Actually, BullMQ 'failed' event is triggered when the job has failed and is moved to the failed set.
    // It is NOT triggered for intermediate failures if retries are set.
    // So we can safely mark it as failed here.
    
    try {
        await db.query(`
            UPDATE jobs 
            SET status = 'failed', 
                error = $2, 
                updated_at = NOW() 
            WHERE id = $1
        `, [jobId, err.message]);
    } catch (e) {
        console.error(`Error failing job ${jobId}`, e);
    }
};

highWorker.on('completed', handleCompleted);
highWorker.on('failed', handleFailed);
defaultWorker.on('completed', handleCompleted);
defaultWorker.on('failed', handleFailed);

// Startup logging
console.log('Workers started');

// Graceful Shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing workers');
  await highWorker.close();
  await defaultWorker.close();
  await redisConnection.quit();
  process.exit(0);
});
