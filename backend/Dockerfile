# Imagem do back-end (Node.js + Express)
FROM node:22-alpine

# Definindo o diretório de trabalho dentro do container
WORKDIR /app

# Copiando o package.json e o package-lock.json para instalar as dependências
COPY package*.json ./

# Instalando somente as dependências de produção, exatamente como no lock
RUN npm ci --omit=dev

# Copiando o restante do conteúdo do projeto para o container
COPY . .

# Rodando sem root (o usuário "node" já existe na imagem oficial)
USER node

# Expondo a porta que o backend vai usar (5000)
EXPOSE 5000

# Comando para rodar a aplicação
CMD ["node", "index.js"]
