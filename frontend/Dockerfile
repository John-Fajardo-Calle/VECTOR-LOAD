# Frontend (Node) container: dependencies only (no UI code yet)
FROM node:24-alpine

WORKDIR /app

COPY package.json /app/package.json
# Copy lockfile if present
COPY package-lock.json /app/package-lock.json
# If a lockfile exists later, Docker will use it; for now keep it simple.
RUN npm install --no-fund --no-audit

# Mount ./frontend at runtime via docker-compose volume
EXPOSE 3000
CMD ["sh", "-lc", "npm run dev -- --host 0.0.0.0 --port 3000"]
