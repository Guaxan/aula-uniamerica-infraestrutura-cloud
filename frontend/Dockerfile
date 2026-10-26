# Etapa 1: Construção da aplicação
FROM node:22-alpine AS build

# Definindo o diretório de trabalho dentro do container
WORKDIR /app

# Copiando o package.json e o package-lock.json para instalar as dependências
COPY package*.json ./

# Instalando as dependências do projeto
RUN npm install

# Copiando todo o conteúdo da pasta do projeto para o container
COPY . .

# O React chama a API em /api, no mesmo endereço do front-end.
# O nginx (etapa 2) repassa /api para o Service do back-end no cluster.
ARG REACT_APP_API_URL=/api
ENV REACT_APP_API_URL=$REACT_APP_API_URL

# Construindo a aplicação para produção
RUN npm run build

# Etapa 2: Servindo a aplicação
FROM nginx:alpine

# Copiando o build da etapa anterior para o diretório padrão do Nginx
COPY --from=build /app/build /usr/share/nginx/html

# Configuração do nginx (no Kubernetes ela é substituída pelo ConfigMap)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expondo a porta 80 para acesso à aplicação
EXPOSE 80

# Comando para iniciar o Nginx e servir a aplicação
CMD ["nginx", "-g", "daemon off;"]
