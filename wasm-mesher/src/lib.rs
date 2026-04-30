use wasm_bindgen::prelude::*;

mod chunk;
mod dump_parser;
mod geometry;
mod lighting;
mod mesher;
mod utils;

use chunk::ChunkData;
use mesher::Mesher;

// Optional: Use wee_alloc for smaller binary size
// #[cfg(feature = "wee_alloc")]
// #[global_allocator]
// static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

// Note: Panic hook would require console_error_panic_hook dependency
// For now, we'll rely on better error messages from expect() calls

/// Main entry point for generating geometry
///
/// Input: Serialized chunk data as TypedArrays
/// Output: Geometry data (positions, normals, colors, uvs, indices)
#[wasm_bindgen]
pub fn generate_geometry(
    section_x: i32,
    section_y: i32,
    section_z: i32,
    section_height: i32,
    world_min_y: i32,
    world_max_y: i32,
    section_data_start_y: i32,
    block_states: &[u16],
    block_light: &[u8],
    sky_light: &[u8],
    biomes: &[u8],
    invisible_blocks: &[u16],
    transparent_blocks: &[u16],
    no_ao_blocks: &[u16],
    cull_identical_blocks: &[u16],
    occluding_blocks: &[u16],
    enable_lighting: bool,
    smooth_lighting: bool,
    sky_light_value: u8,
) -> JsValue {
    let chunk_data_height = (block_states.len() / (16 * 16)) as i32;
    if chunk_data_height < section_height {
        let err_msg = format!(
            "block_states too small: data covers {} Y layers but section_height is {}",
            chunk_data_height,
            section_height
        );
        wasm_bindgen::throw_str(&err_msg);
    }

    let mesher = Mesher::new(
        section_x,
        section_y,
        section_z,
        section_height,
        section_data_start_y,
        world_min_y,
        world_max_y,
        enable_lighting,
        smooth_lighting,
        sky_light_value,
    );

    let result = mesher.generate(
        block_states,
        block_light,
        sky_light,
        biomes,
        invisible_blocks,
        transparent_blocks,
        no_ao_blocks,
        cull_identical_blocks,
        occluding_blocks,
    );

    serde_wasm_bindgen::to_value(&result).expect("Failed to serialize geometry output to JS value")
}

#[wasm_bindgen]
pub fn generate_geometry_multi(
    section_x: i32,
    section_y: i32,
    section_z: i32,
    section_height: i32,
    world_min_y: i32,
    world_max_y: i32,
    section_data_start_y: i32,
    chunk_xs: &[i32],
    chunk_zs: &[i32],
    block_states: &[u16],
    block_light: &[u8],
    sky_light: &[u8],
    biomes: &[u8],
    invisible_blocks: &[u16],
    transparent_blocks: &[u16],
    no_ao_blocks: &[u16],
    cull_identical_blocks: &[u16],
    occluding_blocks: &[u16],
    enable_lighting: bool,
    smooth_lighting: bool,
    sky_light_value: u8,
) -> JsValue {
    let count = chunk_xs.len();
    if count == 0 || chunk_zs.len() != count {
        wasm_bindgen::throw_str("chunk_xs/chunk_zs must be same non-zero length");
    }

    let per_chunk_size = block_states.len() / count;
    let chunk_data_height = (per_chunk_size / (16 * 16)) as i32;
    if chunk_data_height < section_height {
        wasm_bindgen::throw_str("block_states too small: chunk_data_height < section_height");
    }

    let expected_total = per_chunk_size * count;
    if block_states.len() < expected_total {
        wasm_bindgen::throw_str("block_states length too small for chunk count");
    }
    if block_light.len() < expected_total {
        wasm_bindgen::throw_str("block_light length too small for chunk count");
    }
    if sky_light.len() < expected_total {
        wasm_bindgen::throw_str("sky_light length too small for chunk count");
    }
    if biomes.len() < expected_total {
        wasm_bindgen::throw_str("biomes length too small for chunk count");
    }

    let mesher = Mesher::new(
        section_x,
        section_y,
        section_z,
        section_height,
        section_data_start_y,
        world_min_y,
        world_max_y,
        enable_lighting,
        smooth_lighting,
        sky_light_value,
    );

    let mut chunks = Vec::with_capacity(count);
    for i in 0..count {
        let start = i * per_chunk_size;
        let end = start + per_chunk_size;
        chunks.push(ChunkData {
            block_states: &block_states[start..end],
            block_light: &block_light[start..end],
            sky_light: &sky_light[start..end],
            biomes: &biomes[start..end],
            chunk_x: chunk_xs[i],
            chunk_z: chunk_zs[i],
            world_min_y: section_data_start_y,
            world_height: chunk_data_height,
        });
    }

    let result = mesher.generate_multi(
        chunks,
        invisible_blocks,
        transparent_blocks,
        no_ao_blocks,
        cull_identical_blocks,
        occluding_blocks,
    );

    serde_wasm_bindgen::to_value(&result).expect("Failed to serialize geometry output to JS value")
}

/// Parse a 1.18+ Minecraft chunk dump (column.dump() output).
///
/// Returns an object: { blockStates: Uint16Array, biomes: Uint8Array, bytesRead: number }.
/// Throws on parse error.
#[wasm_bindgen(js_name = parseChunkDump118)]
pub fn parse_chunk_dump_1_18(
    buffer: &[u8],
    num_sections: u32,
    max_bits_per_block: u8,
    max_bits_per_biome: u8,
) -> JsValue {
    match dump_parser::parse_dump(buffer, num_sections as usize, max_bits_per_block, max_bits_per_biome) {
        Ok(r) => {
            let obj = js_sys::Object::new();
            let blocks_view = js_sys::Uint16Array::new_with_length(r.block_states.len() as u32);
            blocks_view.copy_from(&r.block_states);
            let biomes_view = js_sys::Uint8Array::new_with_length(r.biomes.len() as u32);
            biomes_view.copy_from(&r.biomes);
            js_sys::Reflect::set(&obj, &JsValue::from_str("blockStates"), &blocks_view).unwrap();
            js_sys::Reflect::set(&obj, &JsValue::from_str("biomes"), &biomes_view).unwrap();
            js_sys::Reflect::set(&obj, &JsValue::from_str("bytesRead"), &JsValue::from_f64(r.bytes_read as f64)).unwrap();
            obj.into()
        }
        Err(e) => wasm_bindgen::throw_str(&format!("parseChunkDump118 error: {}", e)),
    }
}

/// Unpack a single light section (2048 bytes, BitArrayNoSpan bpv=4) into 4096 nibble values.
#[wasm_bindgen(js_name = unpackLightSection118)]
pub fn unpack_light_section_1_18(buffer: &[u8]) -> Vec<u8> {
    match dump_parser::unpack_light_section(buffer) {
        Ok(v) => v,
        Err(e) => wasm_bindgen::throw_str(&format!("unpackLightSection118 error: {}", e)),
    }
}
