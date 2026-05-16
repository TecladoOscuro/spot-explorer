import Dexie, { type EntityTable } from 'dexie'
import type { SavedSpot } from '../types'

const db = new Dexie('spot-explorer') as Dexie & {
  spots: EntityTable<SavedSpot, 'id'>
}

db.version(1).stores({ spots: 'id' })

export async function getSavedSpots(): Promise<SavedSpot[]> {
  return db.spots.orderBy('savedAt').reverse().toArray()
}

export async function saveSpot(spot: SavedSpot): Promise<void> {
  await db.spots.put(spot)
}

export async function deleteSpot(id: string): Promise<void> {
  await db.spots.delete(id)
}
