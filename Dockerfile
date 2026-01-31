FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p output

# Install curl for healthcheck
RUN apk --no-cache add curl

EXPOSE 3000

# CMD is handled by docker-compose
