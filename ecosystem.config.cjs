module.exports = {
  apps: [
    {
      name: "triplesidestudio-backend",
      cwd: "/home/triplesidestudio/tripleside/backend",
      script: "/home/triplesidestudio/tripleside/backend/venv/bin/uvicorn",
      args: "server:app --host 127.0.0.1 --port 8000 --workers 1",
      interpreter: "none",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        PYTHONUNBUFFERED: "1"
      }
    }
  ]
};
