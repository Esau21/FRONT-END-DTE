# Bookeep — front-end

Aplicación web para leer los Documentos Tributarios Electrónicos (DTE) de El Salvador que llegan por correo. Se conecta a una cuenta de Gmail (solo lectura), encuentra los correos con un DTE adjunto y muestra el documento como factura en lugar de JSON.

Es el front-end de la API de Go [`SMPT-DTE`](https://github.com/Esau21/Go-smpt-dte). No funciona sin ella: todo lo que muestra viene de esa API.

## Qué hace

- **Inicio de sesión con Google**, delegado por completo al backend.
- **Resumen** de los últimos 12 meses: compras e IVA del mes, compras por mes y emisores principales.
- **Facturas** guardadas desde el correo, con filtros, estado (pendiente, revisada, pagada), categoría y notas.
- **Excel:** libro de compras y detalle de facturas del periodo elegido.
- **Guardar en la nube:** sube el PDF o JSON de un correo a un bucket, ordenado por cuenta, año, mes y emisor, y lo lista por carpeta en "Archivos en la nube".
- **Verificar en Hacienda** e **imprimir** cada documento.
- **Bandeja** con dos vistas: solo correos con DTE (`.json` adjunto) o todos los correos.
- **Búsqueda** en vivo, con filtros por remitente o asunto, por fecha y por PDF adjunto, y búsquedas recientes. La tecla `/` lleva el cursor al buscador.
- **Detalle del correo** en pestañas:
  - **Documento:** el DTE leído del `.json` (tipo, emisor, receptor, ítems, totales y sello de Hacienda).
  - **PDF:** la representación gráfica de la factura, si el correo la trae.
  - **Correo:** el mensaje con su formato original.
- **Adjuntos** descargables (`.json`, `.pdf` y cualquier otro).
- Diseño adaptable a móvil y tema claro u oscuro según el sistema.

## Requisitos

- Node.js 22 o superior (o solo Docker, si se usa el contenedor).
- La API de Go corriendo, por defecto en `http://localhost:8080`.

## Desarrollo

Desde la carpeta `web/`:

```bash
npm install
npm run dev
```

La app queda en `http://localhost:5173`. El puerto es fijo: si está ocupado, Vite falla en vez de elegir otro, porque el backend redirige a esa dirección después del login.

| Comando           | Qué hace                                         |
| ----------------- | ------------------------------------------------ |
| `npm run dev`     | Servidor de desarrollo con recarga en caliente   |
| `npm run build`   | Revisa tipos y compila a `dist/`                 |
| `npm run lint`    | Revisa el código con ESLint                      |
| `npm run preview` | Sirve `dist/` (sin proxy: las llamadas a la API fallan) |

## Conexión con la API

El navegador nunca llama a la API directamente. Todo lo que empieza con `/api` se reenvía al backend: lo hace Vite en desarrollo y nginx en Docker. Para el navegador es el mismo origen, así que la cookie de sesión viaja sin configurar CORS.

Para apuntar a otra API en desarrollo, crea `web/.env.local`:

```
API_TARGET=http://localhost:9090
```

### Configuración necesaria en el backend

En el `.env` de `SMPT-DTE`:

| Variable           | Valor                    | Por qué                                              |
| ------------------ | ------------------------ | ---------------------------------------------------- |
| `PUBLIC_ORIGIN`    | `http://localhost:8080`  | Origen con el que Google devuelve al backend         |
| `AFTER_LOGIN_PATH` | `http://localhost:5173/` | A dónde vuelve el usuario después de iniciar sesión  |

Si `AFTER_LOGIN_PATH` apunta a otro lado, el login termina en una página del backend y no en esta app. Después de cambiar el `.env` hay que recrear el contenedor del backend (`docker compose up -d --build smpt-dte`); un reinicio no recarga las variables.

### Rutas de la API que se usan

Todas bajo `/api/v1/mail`:

| Método   | Ruta                               | Uso                                  |
| -------- | ---------------------------------- | ------------------------------------ |
| `GET`    | `/auth`                            | Inicia el login con Google           |
| `DELETE` | `/session`                         | Cierra la sesión                     |
| `GET`    | `/me`                              | Usuario con sesión activa            |
| `GET`    | `/messages`                        | Lista de correos (`q`, `limit`, `pageToken`) |
| `GET`    | `/messages/:id`                    | Correo: texto, HTML y lista de adjuntos |
| `GET`    | `/messages/:id/dte`                | DTE leído del `.json` adjunto        |
| `GET`    | `/messages/:id/attachments/:index` | Un adjunto (`?download=1` fuerza la descarga) |

La búsqueda y los filtros se traducen en el front a la sintaxis de búsqueda de Gmail y se envían en `q`.

Las facturas guardadas usan otro grupo de rutas, bajo `/api/v1/invoices`, y necesitan que el backend tenga su base de datos (Postgres) disponible:

| Método  | Ruta       | Uso                                                              |
| ------- | ---------- | ---------------------------------------------------------------- |
| `POST`  | `/sync`    | Revisa una página de correos y guarda los DTE nuevos             |
| `GET`   | ``         | Lista de facturas con filtros (`from`, `to`, `status`, `tipo`, `q`) y sus sumas |
| `GET`   | `/summary` | Totales por mes, emisores principales y facturas por estado      |
| `GET`   | `/export`  | Excel: `kind=compras` (libro de compras) o `kind=detalle`        |
| `PATCH` | `/:id`     | Cambia estado, categoría o notas de una factura                  |

## Docker

Desde la raíz del repositorio (la carpeta que contiene `web/`):

```bash
docker compose up -d --build
```

Construye la app y la sirve con nginx en `http://localhost:5173`. Usa el mismo puerto que el servidor de desarrollo, así que no pueden estar los dos levantados a la vez.

| Variable     | Valor por defecto                  | Qué controla                                  |
| ------------ | ---------------------------------- | --------------------------------------------- |
| `API_TARGET` | `http://host.docker.internal:8080` | URL de la API vista desde dentro del contenedor |
| `WEB_PORT`   | `5173`                             | Puerto publicado en la máquina                |

Si cambias `WEB_PORT`, actualiza también `AFTER_LOGIN_PATH` en el backend.

Cada cambio en el código requiere reconstruir la imagen con el mismo comando.

## Estructura

```
compose.yml                   Contenedor dte-web
web/
├── src/
│   ├── api.ts                Cliente de la API: tipos, llamadas y mensajes de error
│   ├── App.tsx               Toda la interfaz: login, bandeja, búsqueda, detalle y DTE
│   ├── App.css               Estilos de los componentes
│   ├── index.css             Colores, tipografía y tema oscuro
│   └── main.tsx              Punto de entrada
├── vite.config.ts            Servidor de desarrollo y proxy hacia la API
├── Dockerfile                Compilación con Node y entrega con nginx
└── nginx.conf.template       Sirve la app y reenvía /api a la API
```

Tecnologías: React 19, TypeScript, Vite, [Phosphor Icons](https://phosphoricons.com) y la fuente Plus Jakarta Sans.

## Notas de seguridad

- El HTML de los correos se muestra en un `iframe` aislado, sin scripts ni formularios. Las imágenes remotas sí se cargan, así que el remitente puede saber que el correo fue abierto.
- Solo los PDF se abren dentro de la app; los demás adjuntos siempre se descargan.
- La sesión vive en una cookie `HttpOnly` que maneja el backend; el front no guarda credenciales. Lo único que se guarda en el navegador son las búsquedas recientes.

## Problemas comunes

- **Después del login aparece un JSON en `localhost:8080`:** `AFTER_LOGIN_PATH` no apunta al front, o el contenedor del backend no se recreó tras cambiar el `.env`.
- **"El servicio no responde":** la API no está corriendo o `API_TARGET` apunta al lugar equivocado.
- **El puerto 5173 está ocupado:** hay otro `npm run dev` o el contenedor `dte-web` levantado.
- **El correo se ve como texto plano o sin adjuntos:** el backend corre una versión anterior; reconstruye su contenedor.
