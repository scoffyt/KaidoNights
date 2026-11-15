# Kaido Nights dedicated server (also serves the game files)
FROM node:22-slim
ENV NODE_ENV=production PORT=8090 DB_PATH=/data/kaido.db BACKUP_DIR=/data/backups LOG_DIR=/data/logs
WORKDIR /app
COPY . .
RUN useradd -r -u 10001 kaido && mkdir -p /data && chown -R kaido /data
USER kaido
VOLUME ["/data"]
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--no-warnings", "server/index.js"]
