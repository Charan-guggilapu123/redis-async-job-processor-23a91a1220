# Redis Async Job Processor

A backend system for processing long-running tasks asynchronously using a job queue (Redis). Supports CSV export and Email sending jobs.

## Prerequisites

- [Docker](https://www.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)

## Setup & Running

1. **Clone the repository** (if you haven't already).

2. **Configuration**:
    The project comes with a `.env.example` file. Docker Compose will use the environment variables defined in `docker-compose.yml`, which pull from `.env` if present, or use defaults/inline values.
    
    You can create a `.env` file based on `.env.example`, but `docker-compose.yml` is configured to work out of the box with the default services.

3. **Start the application**:
    Run the following command in the root directory:
    ```bash
    docker-compose up --build
    ```
    This will start the API, Worker, Database (Postgres), Redis, and MailHog services.
    - API: http://localhost:3000
    - MailHog UI: http://localhost:8025

4. **Stop the application**:
    ```bash
    docker-compose down
    ```

## API Endpoints

### Health Check
- **GET** `/health`
- Returns `200 OK` if the service is running.

### Create Job
- **POST** `/jobs`
- **Body**:
    ```json
    {
        "type": "CSV_EXPORT", // or "EMAIL_SEND"
        "priority": "default", // or "high"
        "payload": { ... }
    }
    ```
- **Response**: `201 Created`
    ```json
    {
        "jobId": "uuid-string"
    }
    ```

### Get Job Status
- **GET** `/jobs/:id`
- **Response**: `200 OK`
    ```json
    {
      "id": "uuid",
      "type": "CSV_EXPORT",
      "status": "completed",
      "priority": "default",
      "attempts": 1,
      "result": { "filePath": "/usr/src/app/output/uuid.csv" },
      "error": null,
      "createdAt": "Top ISO Date",
      "updatedAt": "ISO Date"
    }
    ```

## Job Types

### CSV_EXPORT
Generates a CSV file from a list of objects.
- **Type**: `CSV_EXPORT`
- **Payload**:
    ```json
    {
        "data": [
            {"id": 1, "name": "Alice", "email": "alice@example.com"},
            {"id": 2, "name": "Bob", "email": "bob@example.com"}
        ]
    }
    ```
- **Output**: File is saved to `./output` directory on the host.

### EMAIL_SEND
Sends an email using the mock SMTP server (MailHog).
- **Type**: `EMAIL_SEND`
- **Payload**:
    ```json
    {
        "to": "user@test.com",
        "subject": "Hello",
        "body": "This is a test email."
    }
    ```
- **Verification**: Check http://localhost:8025.

## Architecture

- **API**: Express.js server that enqueues jobs to Redis.
- **Worker**: Node.js process that consumes jobs from Redis (High Priority first) and processes them.
- **Redis**: Message broker.
- **Postgres**: Stores job metadata and lifecycle status.
- **MailHog**: SMTP mock server.

## Database

The database schema is automatically seeded from `seeds/init.sql`.
Table: `jobs` stores all job information.