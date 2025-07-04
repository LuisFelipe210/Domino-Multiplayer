FROM node:18-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install

COPY . .

# A porta será definida pela variável de ambiente no docker-compose
EXPOSE ${PORT}

# Comando para produção (requer um script "start" no package.json)
# CMD ["node", "dist/server.js"]

# Comando para desenvolvimento (para usar com ts-node-dev)
CMD ["npm", "run", "dev"]