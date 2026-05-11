# Shark Tracking App

This is the guide for running the Shark Tracking Application (Backend + statically served Frontend).

## Components
The application consists of a Node.js server that serves both the API endpoints and the static frontend files from the `public` folder.

The current version also includes a local-file security layer for the Digital Security project:
- hashed admin login
- signed admin tokens
- AES-encrypted private shark coordinates
- RSA-signed community reports
- audit logging

More details are in `shark-docker/SECURITY_FEATURES.md`.

## Runtime Security Files

Generated security files are stored in `shark-docker/runtime/` by default and are ignored by Git:
- `.security/secrets.json`
- `keys/private.pem`
- `keys/public.pem`
- `secret_sharks.enc`
- `users.json`
- `sightings.json`
- `security_audit.log`

This keeps private keys, encryption secrets, password hashes, encrypted private data, and logs out of GitHub.

## How to run the application locally (Without Docker)

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18+ recommended)
- npm (installed automatically with Node.js)

### Steps

1. Open a terminal and navigate to the `shark-docker` folder:
   ```bash
   cd shark-docker
   ```

2. Install dependencies (first time only):
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```
   *(Alternatively, you can use `node server.js`)*

4. Access the application:
   Open your browser and navigate to:
   **[http://localhost:3000](http://localhost:3000)**

## How to run the application using Docker

If you prefer using Docker to isolate the application:

1. From the project root, run Docker Compose:
   ```bash
   docker compose up --build
   ```

2. Open your browser and navigate to **[http://localhost:3000](http://localhost:3000)**.

Docker Compose mounts `./shark-docker/runtime` into the container at `/app/runtime`, so secrets and generated files stay outside the image and outside Git.

Optional: create a real `.env` from the example if you want stable secrets across machines:

```bash
cp shark-docker/.env.example shark-docker/.env
```

Then replace the placeholder values with 32-byte base64 strings:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Manual Docker

You can also build and run the image manually:

1. Navigate to the `shark-docker` folder:
   ```bash
   cd shark-docker
   ```

2. Build the Docker image:
   ```bash
   docker build -t shark-tracker-app .
   ```

3. Run the Docker container with a runtime volume:
   ```bash
   docker run -p 3000:3000 -v "$(pwd)/runtime:/app/runtime" shark-tracker-app
   ```
