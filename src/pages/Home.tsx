import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Circle, Marker, Popup, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAnalysis } from '../hooks/useAnalysis'
import type { AnalyzedSpot, WeightConfig } from '../types'
import { getSavedSpots, saveSpot, deleteSpot } from '../db/spots'
import type { SavedSpot } from '../types'

const selectedIcon = L.divIcon({
  className: 'selected-marker',
  html: `<div style="
    width:26px;height:26px;border-radius:50%;
    background:#ffdd57;border:3px solid #fff;
    box-shadow:0 0 12px rgba(255,221,87,0.7);
    display:flex;align-items:center;justify-content:center;
    font-size:11px;color:#111;font-weight:800;
  "></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

const markerIcon = (score: number) => L.divIcon({
  className: 'custom-marker',
  html: `<div style="
    width:20px;height:20px;border-radius:50%;
    background:${score > 70 ? '#4a9e4a' : score > 40 ? '#d4a017' : '#c0392b'};
    border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;
    font-size:9px;color:#fff;font-weight:700;
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

const waterDotIcon = L.divIcon({
  className: 'water-dot',
  html: `<div style="width:5px;height:5px;border-radius:50%;background:#4da6ff;opacity:0.6"></div>`,
  iconSize: [5, 5],
  iconAnchor: [2, 2],
})

function MapEvents({ onCenterChange }: { onCenterChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => onCenterChange(e.latlng.lat, e.latlng.lng),
  })
  return null
}

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([lat, lng], map.getZoom() < 15 ? 15 : map.getZoom(), { duration: 0.8 })
  }, [lat, lng, map])
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
  const [savedSnack, setSavedSnack] = useState(false)
  const { results, isAnalyzing, progress, analyze, abort, waterGeoJson } = useAnalysis()
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getSavedSpots().then(setSavedSpots).catch(() => {})
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
    await saveSpot({
      id: spot.id,
      lat: spot.lat,
      lng: spot.lng,
      name: `Spot ${spot.score}`,
      notes: '',
      score: spot.score,
      savedAt: Date.now(),
    })
    getSavedSpots().then(setSavedSpots).catch(() => {})
    setSavedSnack(true)
    setTimeout(() => setSavedSnack(false), 1800)
  }

  const handleDeleteSaved = async (id: string) => {
    await deleteSpot(id)
    getSavedSpots().then(setSavedSpots).catch(() => {})
  }

  const handleNavigate = (lat: number, lng: number) => {
    const url = `https://maps.apple.com/?ll=${lat},${lng}&q=Spot&t=m`
    window.open(url, '_blank')
  }

  const handleSelectSpot = (spot: AnalyzedSpot) => {
    setSelectedSpot(spot)
    setBottomSheetExpanded(true)
    resultsRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const topSpots = results.slice(0, 30)

  return (
    <div className="bg-sp-bg text-sp-text fixed inset-0 flex flex-col overflow-hidden">
      {/* Controls bar */}
      <div className="shrink-0 px-4 pt-[env(safe-area-inset-top,16px)] pb-3 bg-sp-card/90 backdrop-blur border-b border-sp-border z-30">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-lg font-bold text-white">Spot Explorer</h1>
          {locating && <span className="text-xs text-sp-muted">Localizando...</span>}
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-sp-muted whitespace-nowrap w-12">🔍 Radio</span>
          <input type="range" min={500} max={20000} step={500} value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            disabled={isAnalyzing} className="flex-1 accent-sp-accent h-1" />
          <span className="text-xs text-sp-text w-14 text-right">{(radius / 1000).toFixed(1)} km</span>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] text-sp-muted whitespace-nowrap w-12">📐 Precisión</span>
          <select value={density} onChange={(e) => setDensity(Number(e.target.value))}
            disabled={isAnalyzing}
            className="bg-sp-surface text-sp-text text-xs rounded px-2 py-1 border border-sp-border flex-1">
            <option value={50}>Alta (50m)</option>
            <option value={100}>Media (100m)</option>
            <option value={200}>Baja (200m)</option>
          </select>
          <span className="text-[10px] text-sp-muted w-14 text-right">
            ~{Math.round((radius / 1000) ** 2 * Math.PI / ((density / 1000) ** 2))} pts
          </span>
        </div>

        {!isAnalyzing ? (
          <button onClick={handleAnalyze}
            className="w-full bg-sp-accent hover:bg-sp-accent-light text-white font-semibold text-sm rounded-lg py-2 transition-colors">
            Analizar zona
          </button>
        ) : (
          <button onClick={abort}
            className="w-full bg-sp-danger hover:bg-red-600 text-white font-semibold text-sm rounded-lg py-2 transition-colors">
            Cancelar
          </button>
        )}
        <p className="text-[10px] text-sp-muted text-center mt-1">Toca el mapa para centrar</p>

        {isAnalyzing && (
          <div className="mt-2">
            <div className="flex justify-between text-xs text-sp-text mb-1">
              <span>Analizando...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-sp-surface rounded-full h-1.5 overflow-hidden">
              <div className="h-full bg-sp-accent transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0 relative z-10">
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={radius > 10000 ? 10 : radius > 5000 ? 12 : 14}
          scrollWheelZoom className="h-full w-full" zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
          />
          <MapEvents onCenterChange={(lat, lng) => setCenter({ lat, lng })} />

          {selectedSpot && <FlyTo lat={selectedSpot.lat} lng={selectedSpot.lng} />}

          <Circle center={[center.lat, center.lng]} radius={radius}
            pathOptions={{
              color: '#ffdd57', fillColor: '#ffdd57', fillOpacity: 0.12, weight: 2.5, dashArray: '10 5',
            }} />

          <Marker position={[center.lat, center.lng]} icon={centerIcon} />

          {selectedSpot && (
            <Marker position={[selectedSpot.lat, selectedSpot.lng]}
              icon={L.divIcon({
                ...selectedIcon.options,
                html: `<div style="${(selectedIcon.options as {html:string}).html.replace('></div>', '>')}${selectedSpot.score}</div>`,
              })} />
          )}

          {topSpots.filter(s => s.id !== selectedSpot?.id).map((spot) => (
            <Marker key={spot.id} position={[spot.lat, spot.lng]} icon={markerIcon(spot.score)}
              eventHandlers={{ click: () => handleSelectSpot(spot) }}>
              <Popup>
                <div className="text-xs">
                  <div className="font-bold text-green-400">{spot.score} pts</div>
                  <div className="text-gray-400">{spot.elevation}m | {spot.aspect}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {selectedSpot && waterGeoJson.map((p, i) => (
            <Marker key={`w-${i}`} position={[p.lat, p.lng]} icon={waterDotIcon}
              opacity={0.5} />
          ))}
        </MapContainer>

        <Legend />

        {savedSnack && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] bg-sp-accent text-white text-xs font-semibold px-4 py-2 rounded-full shadow-lg">
            Spot guardado ✓
          </div>
        )}
      </div>

      {/* Bottom sheet */}
      <div className={`shrink-0 bg-sp-card/95 backdrop-blur border-t border-sp-border transition-all duration-300 z-30 ${
        bottomSheetExpanded ? 'h-[50%]' : 'h-[100px]'
      }`}>
        <div className="flex justify-center py-2 cursor-pointer"
          onClick={() => setBottomSheetExpanded(!bottomSheetExpanded)}>
          <div className="w-10 h-1 bg-sp-border rounded-full" />
        </div>

        <div className="px-4 pb-[env(safe-area-inset-bottom,16px)] overflow-y-auto h-[calc(100%-28px)] no-scrollbar" ref={resultsRef}>
          {selectedSpot ? (
            <div>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-xl font-bold text-white">{selectedSpot.score} pts</div>
                  <div className="text-[11px] text-sp-muted">
                    {selectedSpot.lat.toFixed(4)}, {selectedSpot.lng.toFixed(4)}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleNavigate(selectedSpot.lat, selectedSpot.lng)}
                    className="bg-sp-surface hover:bg-sp-border text-sp-accent-light text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    🧭 Ruta
                  </button>
                  <button onClick={() => handleSaveSpot(selectedSpot)}
                    className="bg-sp-accent hover:bg-sp-accent-light text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    Guardar
                  </button>
                  <button onClick={() => setSelectedSpot(null)}
                    className="text-sp-muted hover:text-white text-sm px-1">
                    ✕
                  </button>
                </div>
              </div>

              {/* Score grid */}
              <div className="grid grid-cols-5 gap-1 mb-3">
                {[
                  { label: 'Sol', score: selectedSpot.metrics.sunScore },
                  { label: 'Agua', score: selectedSpot.metrics.waterScore },
                  { label: 'Viento', score: selectedSpot.metrics.windScore },
                  { label: 'Priv.', score: selectedSpot.metrics.privacyScore },
                  { label: 'Acceso', score: selectedSpot.metrics.accessScore },
                ].map(({ label, score }) => (
                  <div key={label} className="bg-sp-surface rounded-lg p-2 text-center">
                    <div className={`text-sm font-bold ${
                      score >= 70 ? 'text-sp-accent-light' : score >= 40 ? 'text-sp-warning' : 'text-sp-danger'
                    }`}>{Math.round(score)}</div>
                    <div className="text-[10px] text-sp-muted">{label}</div>
                  </div>
                ))}
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
                <div className="text-sp-muted">Elevación</div><div className="text-sp-text">{selectedSpot.elevation}m</div>
                <div className="text-sp-muted">Orientación</div><div className="text-sp-text">{selectedSpot.aspect}</div>
                <div className="text-sp-muted">Pendiente</div><div className="text-sp-text">{selectedSpot.slope}°</div>
                <div className="text-sp-muted">Dist. agua</div><div className="text-sp-text">{selectedSpot.distanceToWater}m</div>
                <div className="text-sp-muted">Dist. camino</div><div className="text-sp-text">{selectedSpot.distanceToPath}m</div>
                <div className="text-sp-muted">Dist. carretera</div><div className="text-sp-text">{selectedSpot.distanceToRoad}m</div>
              </div>

              {/* Strengths & weaknesses */}
              {selectedSpot.strengths.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs font-semibold text-sp-accent-light mb-1">Fortalezas</div>
                  {selectedSpot.strengths.map((s, i) => (
                    <div key={i} className="text-xs text-sp-text flex items-start gap-1 mb-0.5">
                      <span className="text-sp-accent-light mt-0.5">+</span> {s}
                    </div>
                  ))}
                </div>
              )}
              {selectedSpot.weaknesses.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-sp-warning mb-1">Debilidades</div>
                  {selectedSpot.weaknesses.map((w, i) => (
                    <div key={i} className="text-xs text-sp-text flex items-start gap-1 mb-0.5">
                      <span className="text-sp-warning mt-0.5">−</span> {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Results list or empty state
            <>
              {savedSpots.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-semibold text-sp-accent-light">⭐ Favoritos ({savedSpots.length})</div>
                  </div>
                  {savedSpots.map((s) => (
                    <div key={s.id}
                      className="bg-sp-surface rounded-lg px-3 py-2 flex items-center gap-3 mb-1">
                      <button
                        onClick={() => {
                          setCenter({ lat: s.lat, lng: s.lng })
                          setBottomSheetExpanded(false)
                        }}
                        className={`text-sm font-bold ${s.score >= 70 ? 'text-sp-accent-light' : s.score >= 40 ? 'text-sp-warning' : 'text-sp-danger'}`}>
                        {s.score}
                      </button>
                      <span className="text-xs text-sp-text flex-1">{s.name}</span>
                      <button onClick={() => handleNavigate(s.lat, s.lng)}
                        className="text-sp-accent-light text-xs mr-1">🧭</button>
                      <button onClick={() => handleDeleteSaved(s.id)}
                        className="text-sp-danger text-xs">Eliminar</button>
                    </div>
                  ))}
                </div>
              )}

              {results.length > 0 ? (
                <>
                  <div className="text-xs text-sp-muted mb-2">
                    {results.length} puntos analizados · top {topSpots.length}
                  </div>
                  <div className="space-y-1">
                    {topSpots.map((spot, i) => (
                      <button key={spot.id} onClick={() => handleSelectSpot(spot)}
                        className="w-full bg-sp-surface hover:bg-sp-border rounded-lg px-3 py-2 flex items-center gap-3 transition-colors text-left">
                        <span className="text-xs text-sp-muted w-5">#{i + 1}</span>
                        <span className={`text-sm font-bold w-9 ${
                          spot.score >= 70 ? 'text-sp-accent-light' : spot.score >= 40 ? 'text-sp-warning' : 'text-sp-danger'
                        }`}>{spot.score}</span>
                        <span className="text-xs text-sp-text flex-1 truncate">
                          {spot.elevation}m | {spot.aspect} | {spot.slope}°
                        </span>
                        <span className="text-[10px] text-sp-muted">
                          {spot.lat.toFixed(4)}, {spot.lng.toFixed(4)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              ) : !isAnalyzing && savedSpots.length === 0 && (
                <div className="text-center text-sp-muted text-sm py-6">
                  <div className="text-3xl mb-2">🗺️</div>
                  <p>Toca el mapa para centrar</p>
                  <p className="text-xs mt-1">y pulsa "Analizar zona"</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
