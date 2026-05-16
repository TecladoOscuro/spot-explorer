export interface LatLng {
  lat: number
  lng: number
}

export interface SpotMetrics {
  sunScore: number
  waterScore: number
  windScore: number
  privacyScore: number
  accessScore: number
}

export interface AnalyzedSpot extends LatLng {
  id: string
  score: number
  metrics: SpotMetrics
  elevation: number
  aspect: string
  slope: number
  distanceToWater: number
  distanceToPath: number
  distanceToRoad: number
  strengths: string[]
  weaknesses: string[]
}

export interface WeightConfig {
  sun: number
  water: number
  wind: number
  privacy: number
  access: number
}

export interface SavedSpot {
  id: string
  lat: number
  lng: number
  name: string
  notes: string
  score: number
  savedAt: number
}
