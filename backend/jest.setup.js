// backend/jest.setup.js
const path = require('path');
const dotenv = require('dotenv');

// Carrega o ficheiro .env localizado na pasta raiz do projeto (um nível acima)
dotenv.config({ path: path.resolve(__dirname, '../.env') });