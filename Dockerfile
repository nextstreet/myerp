FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .

RUN mkdir -p /app/storage && chown -R node:node /app
USER node

EXPOSE 3100
CMD ["node", "src/index.js"]
