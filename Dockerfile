FROM node:20-alpine

WORKDIR /app

# Install build dependencies for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/
COPY docs/ ./docs/
RUN mkdir -p data

ENV PORT=3000
ENV DB_PATH=/app/data/tracker.db

EXPOSE 3000

CMD ["npm", "start"]
