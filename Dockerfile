# One container: the Node server serves the API and the built UI (dist/).
# Works on any Docker host (Render, Railway, Fly.io, a VPS). Secrets come from
# the host's environment variables, never from this file.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY shared ./shared
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 8787
# Pending database migrations are applied on start, before requests are taken.
CMD ["npm", "start"]
