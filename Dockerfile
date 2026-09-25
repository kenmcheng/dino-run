FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY shared ./shared
COPY public ./public
ENV PORT=8090 HOST=0.0.0.0
EXPOSE 8090
USER node
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8090/healthz || exit 1
CMD ["node", "server/index.js"]
