FROM node:20-alpine

WORKDIR /app

# Copy package config files
COPY package*.json ./

# Clean production dependencies install
RUN npm ci --only=production

# Install pm2 globally to enable pm2-runtime command
RUN npm install -g pm2

# Copy code source
COPY . .

EXPOSE 3000

# Execute server using pm2-runtime for Docker environments
CMD ["pm2-runtime", "ecosystem.config.js", "--env", "production"]
