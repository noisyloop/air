# air API + worker image (same image, different command)
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @air/api --include-workspace-root
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && npm run build

FROM node:22-slim
WORKDIR /app/apps/api
ENV NODE_ENV=production
# ffmpeg powers the audio pipeline (transcodes, loudness, waveforms, art thumbs)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/package.json ./
EXPOSE 4000
CMD ["node", "dist/server.js"]
