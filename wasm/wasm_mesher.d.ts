/* tslint:disable */
/* eslint-disable */

/**
 * Main entry point for generating geometry
 *
 * Input: Serialized chunk data as TypedArrays
 * Output: Geometry data (positions, normals, colors, uvs, indices)
 */
export function generate_geometry(section_x: number, section_y: number, section_z: number, section_height: number, world_min_y: number, world_max_y: number, section_data_start_y: number, block_states: Uint16Array, block_light: Uint8Array, sky_light: Uint8Array, biomes: Uint8Array, invisible_blocks: Uint16Array, transparent_blocks: Uint16Array, no_ao_blocks: Uint16Array, cull_identical_blocks: Uint16Array, occluding_blocks: Uint16Array, enable_lighting: boolean, smooth_lighting: boolean, sky_light_value: number): any;

export function generate_geometry_multi(section_x: number, section_y: number, section_z: number, section_height: number, world_min_y: number, world_max_y: number, section_data_start_y: number, chunk_xs: Int32Array, chunk_zs: Int32Array, block_states: Uint16Array, block_light: Uint8Array, sky_light: Uint8Array, biomes: Uint8Array, invisible_blocks: Uint16Array, transparent_blocks: Uint16Array, no_ao_blocks: Uint16Array, cull_identical_blocks: Uint16Array, occluding_blocks: Uint16Array, enable_lighting: boolean, smooth_lighting: boolean, sky_light_value: number): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly generate_geometry: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number) => any;
  readonly generate_geometry_multi: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number) => any;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
