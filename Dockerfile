# Lupi mannari - immagine di produzione
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dipendenze prima, così Docker riusa la cache se cambia solo il codice.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# La cache della voce teatrale si scrive in questa cartella (montabile come volume).
RUN mkdir -p /app/cache-voce && chown -R node:node /app/cache-voce
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/salute || exit 1

CMD ["node", "server.js"]
