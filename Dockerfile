FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY dist/ dist/
COPY scripts/ scripts/

EXPOSE 4888

ENV MESH_PORT=4888

ENTRYPOINT ["node", "dist/main.js"]
CMD ["start", "--no-terminal"]
