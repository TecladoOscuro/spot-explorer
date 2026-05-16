# Spot Explorer 📍

**Encuentra el lugar perfecto analizando topografía, sol, agua y discreción.**

Una PWA con mapa interactivo que analiza terrenos usando datos reales de elevación para puntuar los mejores spots según múltiples parámetros configurables.

### Funcionalidades
- 🗺️ Mapa topográfico OpenTopoMap con curvas de nivel
- 📡 Geolocalización automática
- 🔍 Análisis por radio (500m - 20km)
- ☀️ 6 métricas: sol, agua, viento, discreción, acceso, suelo
- 📊 Puntuación ponderada 0-100 con pesos configurables
- 💾 Guardado de spots favoritos

### URL

🔗 **[tecladooscuro.github.io/spot-explorer](https://tecladooscuro.github.io/spot-explorer/)**

### Tech Stack

- React 19 + TypeScript + Vite 8
- Leaflet + react-leaflet (mapas interactivos)
- OpenTopoData API (elevación SRTM gratuita)
- Open-Meteo API (datos meteorológicos gratuitos)
- Tailwind CSS v4 (tema verde naturaleza)
- Dexie.js (IndexedDB para spots guardados)
- PWA (vite-plugin-pwa, modo standalone)

### Instalación

```bash
npm install
npm run dev     # desarrollo
npm run build   # producción
```

### Uso en iPhone

Abre la URL en Safari, pulsa **Compartir → Añadir a pantalla de inicio**.
