# Imagem do banco (MongoDB) com a carga inicial de tarefas
FROM mongo:7

# Scripts nesta pasta rodam só na primeira inicialização (volume vazio)
COPY ./init-mongo.js /docker-entrypoint-initdb.d/

EXPOSE 27017
