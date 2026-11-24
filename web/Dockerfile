# ---- Etapa 1: compilar la app ----
FROM node:22-alpine AS build

WORKDIR /app

# Primero solo las dependencias, para aprovechar la caché de Docker
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Etapa 2: servir los archivos estáticos ----
FROM nginx:1.29-alpine AS release

# La imagen de nginx reemplaza ${API_TARGET} en esta plantilla al arrancar
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# URL de la API de Go, vista desde dentro del contenedor
ENV API_TARGET=http://host.docker.internal:8080

EXPOSE 80
