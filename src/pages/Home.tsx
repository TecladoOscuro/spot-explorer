import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Circle, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useAnalysis } from '../hooks/useAnalysis'
import type { AnalyzedSpot, WeightConfig } from '../types'
import { getSavedSpots, saveSpot, deleteSpot } from '../db/spots'
import type { SavedSpot } from '../types'

const markerIcon = (score: number) => L.divIcon({
  className: 'custom-marker',
  html: `<div style="
    width:20px;height:20px;border-radius:50%;
    background:${score > 70 ? '#4a9e4a' : score > 40 ? '#d4a017' : '#c0392b'};
    border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;
    font-size:10px;color:#fff;font-weight:700;
  ">${score}</div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  popupAnchor: [0, -12],
})

const centerIcon = L.divIcon({
  className: 'center-marker',
  html: `<div style="
    width:16px;height:16px;border-radius:50%;
    background:#6bcf6b;border:3px solid #fff;
    box-shadow:0 0 8px rgba(107,207,107,0.6);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
})

function MapEvents({ onCenterChange }: { onCenterChange: (lat: number, lng: number) => void }) {
  const map = useMap()
  useMapEvents({
    moveend: () => {
      const c = map.getCenter()
      onCenterChange(c.lat, c.lng)
    },
  })
  return null
}

function Legend() {
  return (
    <div className="absolute bottom-2 left-2 z-[1000] bg-sp-card/90 backdrop-blur rounded-lg px-3 py-2 text-xs border border-sp-border">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-3 h-3 rounded-full bg-sp-accent inline-block" />
        <span className="text-sp-text">Bueno (&gt;70)</span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <span className="w-3 h-3 rounded-full bg-sp-warning inline-block" />
        <span className="text-sp-text">Regular (&gt;40)</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-sp-danger inline-block" />
        <span className="text-sp-text">Malo (&le;40)</span>
      </div>
    </div>
  )
}

const defaultWeights: WeightConfig = { sun: 5, water: 5, wind: 3, privacy: 4, access: 3 }

export function Home() {
  const [center, setCenter] = useState({ lat: 41.65, lng: 2.0 })
  const [radius, setRadius] = useState(3000)
  const [density, setDensity] = useState(100)
  const [selectedSpot, setSelectedSpot] = useState<AnalyzedSpot | null>(null)
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false)
  const [savedSpots, setSavedSpots] = useState<SavedSpot[]>([])
  const [locating, setLocating] = useState(true)
  const { results, isAnalyzing, progress, analyze, abort } = useAnalysis()
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSavedSpots().then(setSavedSpots)
  }, [])

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          setLocating(false)
        },
        () => setLocating(false),
        { enableHighAccuracy: true, timeout: 10000 },
      )
    }
  }, [])

  const handleAnalyze = () => {
    setSelectedSpot(null)
    analyze(center, radius, density, defaultWeights)
  }

  const handleSaveSpot = async (spot: AnalyzedSpot) => {
    const saved: SavedSpot = {
      id: spot.id,
      lat: spot.lat,
      lng: spot.lng,
      name: `Spot ${spot.score}`,
      notes: '',
      score: spot.score,
      savedAt: Date.now(),
    }
    await saveSpot(saved)
    setSavedSpots(await getSavedSpots())
  }

  const handleDeleteSaved = async (id: string) => {
    await deleteSpot(id)
    setSavedSpots(await getSavedSpots())
  }

  const topSpots = results.slice(0, 30)

  return (
    <div className="bg-sp-bg h-dvh flex flex-col overflow-hidden">
      {/* Top controls */}
      <div
        className="shrink-0 px-4 pt-[env(safe-area-inset-top,16px)] pb-3 bg-sp-card/90 backdrop-blur border-b border-sp-border z-20"
      >
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-white">Spot Explorer</h1>
          {locating && <span className="text-xs text-sp-muted">Localizando...</span>}
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-sp-muted whitespace-nowrap">Radio</span>
          <input
            type="range"
            min={500}
            max={20000}
            step={500}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            disabled={isAnalyzing}
            className="flex-1 accent-sp-accent h-1"
          />
          <span className="text-xs text-sp-text w-16 text-right">{(radius / 1000).toFixed(1)}km</span>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
            disabled={isAnalyzing}
            className="bg-sp-surface text-sp-text text-xs rounded px-2 py-1 border border-sp-border"
          >
            <option value={50}>50m</option>
            <option value={100}>100m</option>
            <option value={200}>200m</option>
          </select>

          {!isAnalyzing ? (
            <button
              onClick={handleAnalyze}
              className="flex-1 bg-sp-accent hover:bg-sp-accent-light text-white font-semibold text-sm rounded-lg py-2 transition-colors"
            >
              Analizar zona
            </button>
          ) : (
            <button
              onClick={abort}
              className="flex-1 bg-sp-danger hover:bg-red-600 text-white font-semibold text-sm rounded-lg py-2 transition-colors"
            >
              Cancelar
            </button>
          )}
        </div>

        {isAnalyzing && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-sp-text mb-1">
              <span>Analizando {Math.round((radius / 1000) ** 2 * Math.PI / ((density / 1000) ** 2))} puntos...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-sp-surface rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-sp-accent transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={radius > 10000 ? 10 : radius > 5000 ? 12 : 14}
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          />
          <MapEvents onCenterChange={(lat, lng) => setCenter({ lat, lng })} />
          <Circle
            center={[center.lat, center.lng]}
            radius={radius}
            pathOptions={{
              color: '#4a9e4a',
              fillColor: '#4a9e4a',
              fillOpacity: 0.08,
              weight: 1.5,
              dashArray: '6 4',
            }}
          />
          <Marker position={[center.lat, center.lng]} icon={centerIcon} />
          {topSpots.map((spot) => (
            <Marker
              key={spot.id}
              position={[spot.lat, spot.lng]}
              icon={markerIcon(spot.score)}
              eventHandlers={{
                click: () => {
                  setSelectedSpot(spot)
                  setBottomSheetExpanded(true)
                  resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                },
              }}
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-bold text-green-400">{spot.score} pts</div>
                  <div className="text-gray-400">{spot.elevation}m | {spot.aspect}</div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        <Legend />

        {topSpots.length > 0 && (
          <div className="absolute top-2 right-2 z-[1000] bg-sp-card/90 backdrop-blur rounded-lg px-2 py-1 text-xs text-sp-text border border-sp-border">
            Top {topSpots.length}
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <div
        className={`shrink-0 bg-sp-card/95 backdrop-blur border-t border-sp-border transition-all duration-300 z-20 ${
          bottomSheetExpanded ? 'h-[45%]' : 'h-[120px]'
        }`}
      >
        {/* Handle */}
        <div
          className="flex justify-center py-2 cursor-pointer"
          onClick={() => setBottomSheetExpanded(!bottomSheetExpanded)}
        >
          <div className="w-10 h-1 bg-sp-border rounded-full" />
        </div>

        {selectedSpot ? (
          <div className="px-4 pb-[env(safe-area-inset-bottom,16px)] overflow-y-auto h-[calc(100%-28px)] no-scrollbar">
            {/* Detail card */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xl font-bold text-white">{selectedSpot.score} pts</div>
                <div className="text-xs text-sp-muted">
                  {selectedSpot.lat.toFixed(5)}, {selectedSpot.lng.toFixed(5)}
                </div>
              </div>
              <button
                onClick={() => setSelectedSpot(null)}
                className="text-sp-muted hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            {/* Scores */}
            <div className="grid grid-cols-5 gap-1 mb-3">
              {[
                { label: 'Sol', score: selectedSpot.metrics.sunScore, key: 'sunScore' as const },
                { label: 'Agua', score: selectedSpot.metrics.waterScore, key: 'waterScore' as const },
                { label: 'Viento', score: selectedSpot.metrics.windScore, key: 'windScore' as const },
                { label: 'Priv.', score: selectedSpot.metrics.privacyScore, key: 'privacyScore' as const },
                { label: 'Acceso', score: selectedSpot.metrics.accessScore, key: 'accessScore' as const },
              ].map(({ label, score }) => (
                <div key={label} className="bg-sp-surface rounded-lg p-2 text-center">
                  <div
                    className={`text-sm font-bold ${
                      score >= 70 ? 'text-sp-accent-light' : score >= 40 ? 'text-sp-warning' : 'text-sp-danger'
                    }`}
                  >
                    {Math.round(score)}
                  </div>
                  <div className="text-[10px] text-sp-muted">{label}</div>
                </div>
              ))}
            </div>

            {/* Info rows */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
              <div className="text-sp-muted">Elevación</div>
              <div className="text-sp-text">{selectedSpot.elevation}m</div>
              <div className="text-sp-muted">Orientación</div>
              <div className="text-sp-text">{selectedSpot.aspect}</div>
              <div className="text-sp-muted">Pendiente</div>
              <div className="text-sp-text">{selectedSpot.slope}°</div>
              <div className="text-sp-muted">Dist. agua</div>
              <div className="text-sp-text">{selectedSpot.distanceToWater}m</div>
              <div className="text-sp-muted">Dist. camino</div>
              <div className="text-sp-text">{selectedSpot.distanceToPath}m</div>
              <div className="text-sp-muted">Dist. carretera</div>
              <div className="text-sp-text">{selectedSpot.distanceToRoad}m</div>
            </div>

            {/* Strengths & weaknesses */}
            {selectedSpot.strengths.length > 0 && (
              <div className="mb-2">
                <div className="text-xs font-semibold text-sp-accent-light mb-1">Fortalezas</div>
                {selectedSpot.strengths.map((s) => (
                  <div key={s} className="text-xs text-sp-text flex items-start gap-1 mb-0.5">
                    <span className="text-sp-accent-light mt-0.5">+</span> {s}
                  </div>
                ))}
              </div>
            )}
            {selectedSpot.weaknesses.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-semibold text-sp-warning mb-1">Debilidades</div>
                {selectedSpot.weaknesses.map((w) => (
                  <div key={w} className="text-xs text-sp-text flex items-start gap-1 mb-0.5">
                    <span className="text-sp-warning mt-0.5">−</span> {w}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => handleSaveSpot(selectedSpot)}
              className="w-full bg-sp-accent hover:bg-sp-accent-light text-white font-semibold text-sm rounded-lg py-2 transition-colors"
            >
              Guardar spot
            </button>
          </div>
        ) : (
          <div className="px-4 pb-[env(safe-area-inset-bottom,16px)] overflow-y-auto h-[calc(100%-28px)] no-scrollbar" ref={resultsRef}>
            {results.length > 0 ? (
              <>
                <div className="text-xs text-sp-muted mb-2">
                  {results.length} puntos analizados — {topSpots.length} mejores mostrados
                </div>
                <div className="space-y-1">
                  {topSpots.map((spot, i) => (
                    <button
                      key={spot.id}
                      onClick={() => {
                        setSelectedSpot(spot)
                        resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      className="w-full bg-sp-surface hover:bg-sp-border rounded-lg px-3 py-2 flex items-center gap-3 transition-colors text-left"
                    >
                      <span className="text-xs text-sp-muted w-5">#{i + 1}</span>
                      <span
                        className={`text-sm font-bold w-9 ${
                          spot.score >= 70 ? 'text-sp-accent-light' : spot.score >= 40 ? 'text-sp-warning' : 'text-sp-danger'
                        }`}
                      >
                        {spot.score}
                      </span>
                      <span className="text-xs text-sp-text flex-1 truncate">
                        {spot.elevation}m | {spot.aspect} | Pend. {spot.slope}°
                      </span>
                      <span className="text-[10px] text-sp-muted">
                        {spot.lat.toFixed(4)}, {spot.lng.toFixed(4)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : !isAnalyzing && (
              <div className="text-center text-sp-muted text-sm py-6">
                <div className="text-3xl mb-2">🗺️</div>
                <p>Selecciona una zona y pulsa "Analizar zona"</p>
                <p className="text-xs mt-1">para encontrar los mejores spots</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Saved spots section */}
      {savedSpots.length > 0 && !selectedSpot && !isAnalyzing && results.length === 0 && bottomSheetExpanded && (
        <div className="px-4 pb-4">
          <div className="text-xs font-semibold text-sp-accent-light mb-2">Spots guardados</div>
          {savedSpots.map((s) => (
            <div key={s.id} className="bg-sp-surface rounded-lg px-3 py-2 flex items-center gap-3 mb-1">
              <span className={`text-sm font-bold ${s.score >= 70 ? 'text-sp-accent-light' : s.score >= 40 ? 'text-sp-warning' : 'text-sp-danger'}`}>
                {s.score}
              </span>
              <span className="text-xs text-sp-text flex-1">{s.name}</span>
              <button
                onClick={() => handleDeleteSaved(s.id)}
                className="text-sp-danger text-xs hover:text-red-400"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
