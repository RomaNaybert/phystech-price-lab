FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.mjs sources.mjs web-search.mjs product-cards.mjs deep-review.mjs ./
COPY public/ ./public/
USER node
ENV HOST=0.0.0.0 PORT=8780
EXPOSE 8780
CMD ["node", "server.mjs"]
