# A versão da tag da imagem (v1.48.0) precisa bater EXATAMENTE com a versão do pacote
# "playwright" no package.json — os browsers já vêm instalados nessa imagem pra essa
# versão específica; se o npm instalar uma versão diferente do pacote, o Chromium
# instalado não bate e o launch falha ("Executable doesn't exist..."). Se subir a versão
# de um lado, sobe do outro também.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
