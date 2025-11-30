# Servidor de Scraping de URLs

Este servidor backend proporciona funcionalidad de scraping para extraer contenido real de URLs (especialmente Twitter/X) antes de enviarlo a Gemini para análisis.

## Instalación

Las dependencias se instalan automáticamente con `npm install` en la raíz del proyecto.

## Ejecución

### Opción 1: Ejecutar servidor y frontend por separado

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend
npm run server
```

### Opción 2: Ejecutar ambos simultáneamente

```bash
npm run dev:all
```

## Configuración

El servidor se ejecuta en el puerto 3001 por defecto. Puedes cambiarlo con la variable de entorno:

```bash
PORT=3001 npm run server
```

El frontend espera el backend en `http://localhost:3001`. Puedes configurar una URL diferente con la variable de entorno `SCRAPER_API_URL` en el frontend.

## Endpoints

### GET /health
Health check del servidor.

### POST /api/scrape-url
Scrapea una URL y retorna su contenido.

**Request:**
```json
{
  "url": "https://x.com/user/status/123456"
}
```

**Response:**
```json
{
  "url": "https://x.com/user/status/123456",
  "content": "Contenido del tweet...",
  "author": "Nombre del autor",
  "date": "2025-11-29T07:50:00Z",
  "type": "twitter",
  "metadata": {
    "threadCount": 0
  }
}
```

## Tipos de URLs Soportadas

- **Twitter/X**: Extrae contenido del tweet, autor, fecha y hilos
- **GitHub**: Extrae descripción y README del repositorio
- **Artículos/Blogs**: Extrae contenido principal del artículo

## Notas

- El servidor usa Puppeteer para scraping, que requiere Chrome/Chromium
- El scraping puede ser lento (10-30 segundos por URL)
- Twitter/X puede bloquear scraping agresivo
- Si el backend no está disponible, el frontend continuará sin scraping (fallback)

