FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY dist/ dist/
COPY scripts/ scripts/

# Run as non-root user for security
RUN addgroup -S meshsig && adduser -S meshsig -G meshsig \
  && chown -R meshsig:meshsig /app
USER meshsig

EXPOSE 4888

ENV MESH_PORT=4888

ENTRYPOINT ["node", "dist/main.js"]
CMD ["start", "--no-terminal"]
