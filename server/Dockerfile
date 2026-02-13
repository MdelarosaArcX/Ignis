# Use Node.js LTS
FROM node:18

# Set working directory
WORKDIR /app

# Copy package.json first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Install ffmpeg for metadata and conversion
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*


# Copy the rest of the code
COPY . .

# Expose port
EXPOSE 3001

# Start the server
CMD ["npm", "start"]