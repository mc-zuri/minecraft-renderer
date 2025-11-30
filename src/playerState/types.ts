import { ItemSelector } from 'mc-assets/dist/itemDefinitions'

export type GameMode = 'survival' | 'creative' | 'adventure' | 'spectator'

export interface Team {
  id: string
  name: string
  color: string
  prefix: string
  suffix: string
  players: string[]
}

export interface HandItemBlock {
  itemId?: number
  blockId?: number
  name?: string
  count?: number
  damage?: number
  enchants?: any[]
}

export type MovementState = 'NOT_MOVING' | 'WALKING' | 'SPRINTING' | 'SNEAKING'
export type ItemSpecificContextProperties = Partial<
  Pick<
    ItemSelector['properties'],
    | 'minecraft:using_item'
    | 'minecraft:use_duration'
    | 'minecraft:use_cycle'
    | 'minecraft:display_context'
  >
>
export type CameraPerspective = 'first_person' | 'third_person_back' | 'third_person_front'

export type BlockShape = { position: { x: number, y: number, z: number }; width: number; height: number; depth: number; }
export type BlocksShapes = BlockShape[]
