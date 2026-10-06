FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PORT=3000
ENV POS_DB_PATH=/data/pos.sqlite

WORKDIR /app
COPY package.json server.js ./
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server.js"]
