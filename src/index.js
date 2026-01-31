const express = require('express');
const bodyParser = require('body-parser');
const { defaultQueue, highQueue } = require('./queue');
const db = require('./db');
require('dotenv').config();

const app = express();
app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => res.status(200).send('OK'));

// POST /jobs
app.post('/jobs', async (req, res) => {
  const { type, priority = 'default', payload } = req.body;
  
  if (!type || !payload) {
    return res.status(400).json({ error: 'Type and payload are required' });
  }

  try {
    const result = await db.query(
      'INSERT INTO jobs (type, priority, payload, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [type, priority, payload, 'pending']
    );
    const jobId = result.rows[0].id;

    const queue = priority === 'high' ? highQueue : defaultQueue;
    
    // Pass jobId in data so worker can access it easily, 
    // and set opts.jobId to allow deduplication/lookup if needed.
    await queue.add(type, { jobId, type, payload }, {
      jobId: jobId,
      attempts: 3, // Retry up to 3 times
      backoff: {
        type: 'exponential',
        delay: 1000,
      }
    });

    res.status(201).json({ jobId });
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /jobs/:id
app.get('/jobs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];
    res.json({
        id: job.id,
        type: job.type,
        status: job.status,
        priority: job.priority,
        attempts: job.attempts,
        result: job.result,
        error: job.error,
        createdAt: job.created_at,
        updatedAt: job.updated_at
    });
  } catch (error) {
    if (error.code === '22P02') { // Invalid UUID format
       return res.status(404).json({ error: 'Job not found' });
    }
    console.error('Error fetching job:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.API_PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    db.pool.end();
  });
});
