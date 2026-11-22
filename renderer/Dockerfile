FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY render.js server.js rerender.js chat.js ./
ENV PORT=3100 OUTPUT_DIR=/data/output
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node", "server.js"]
