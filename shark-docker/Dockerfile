FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install

COPY . .
ENV SHARK_RUNTIME_DIR=/app/runtime
RUN mkdir -p /app/runtime
VOLUME ["/app/runtime"]
EXPOSE 3000
CMD [ "node", "server.js" ]
