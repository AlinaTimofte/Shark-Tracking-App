# Shark Tracking App

This is the guide for running the Shark Tracking Application (Backend + statically served Frontend).

## Components
The application consists of a Node.js (Express) server that serves both the API endpoints and the static frontend files from the `public` folder.

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

1. Navigate to the `shark-docker` folder:
   ```bash
   cd shark-docker
   ```

2. Build the Docker image:
   ```bash
   docker build -t shark-tracker-app .
   ```

3. Run the Docker container:
   ```bash
   docker run -p 3000:3000 -d shark-tracker-app
   ```

4. Open your browser and navigate to **[http://localhost:3000](http://localhost:3000)**.

---

**Note regarding application modes:**
The server reads the `secret_sharks.json` file if it exists (in which case it runs in **PRIVATE (Secret File Loaded)** mode). If the file is not present locally, it will default to **PUBLIC (Demo Mode)**, using the coordinates suited for this level of access.
