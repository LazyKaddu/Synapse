use synapse_common::{Result, SynapseError};

const PREFIX_BYTE_LENGTH: usize = 11;
const PALETTE_ENTRY_BYTE_LENGTH: usize = 4;
const RLE_PAIR_BYTE_LENGTH: usize = 2;
const MAX_RLE_RUN_LENGTH: u64 = 255;

const STACK_MAGIC: &[u8; 4] = b"SPS\x01";
const STACK_HEADER_BYTE_LENGTH: usize = 16;
const STACK_LAYER_PREFIX_BYTE_LENGTH: usize = 6;

/// Parsed metadata from a binary `PrefabCodec` payload header and RLE stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrefabHeaderMeta {
    pub width: u16,
    pub height: u16,
    pub anchor_x: i16,
    pub anchor_y: i16,
    pub anchor_z: i16,
    pub palette_count: u8,
    pub run_count: usize,
}

/// Validates either a single-layer `PrefabCodec` payload (10-byte header + 1-byte paletteCount)
/// or a multi-layer `SPS\x01` stacked prefab envelope (16-byte header) without allocating an inflated grid.
pub fn validate_prefab_payload(bytes: &[u8]) -> Result<PrefabHeaderMeta> {
    if bytes.len() >= STACK_HEADER_BYTE_LENGTH && &bytes[0..4] == STACK_MAGIC {
        return validate_stacked_prefab_payload(bytes);
    }
    validate_single_layer_payload(bytes)
}

fn validate_stacked_prefab_payload(bytes: &[u8]) -> Result<PrefabHeaderMeta> {
    let layer_count = u16::from_le_bytes([bytes[4], bytes[5]]);
    let width = u16::from_le_bytes([bytes[6], bytes[7]]);
    let height = u16::from_le_bytes([bytes[8], bytes[9]]);
    let anchor_x = i16::from_le_bytes([bytes[10], bytes[11]]);
    let anchor_y = i16::from_le_bytes([bytes[12], bytes[13]]);
    let anchor_z = i16::from_le_bytes([bytes[14], bytes[15]]);

    if layer_count == 0 {
        return Err(SynapseError::Validation(
            "Invalid stacked prefab buffer: layer_count must be >= 1.".to_string(),
        ));
    }

    let mut cursor = STACK_HEADER_BYTE_LENGTH;
    let mut max_palette_count: u8 = 0;
    let mut total_run_count: usize = 0;
    let mut seen_z = std::collections::HashSet::with_capacity(layer_count as usize);

    for _ in 0..layer_count {
        if cursor + STACK_LAYER_PREFIX_BYTE_LENGTH > bytes.len() {
            return Err(SynapseError::Validation(
                "Invalid stacked prefab buffer: truncated layer header.".to_string(),
            ));
        }

        let z_index = i16::from_le_bytes([bytes[cursor], bytes[cursor + 1]]);
        let layer_len = u32::from_le_bytes([
            bytes[cursor + 2],
            bytes[cursor + 3],
            bytes[cursor + 4],
            bytes[cursor + 5],
        ]) as usize;
        cursor += STACK_LAYER_PREFIX_BYTE_LENGTH;

        if !seen_z.insert(z_index) {
            return Err(SynapseError::Validation(format!(
                "Invalid stacked prefab buffer: duplicate layer z_index {}.",
                z_index
            )));
        }

        if cursor.checked_add(layer_len).is_none_or(|end| end > bytes.len()) {
            return Err(SynapseError::Validation(
                "Invalid stacked prefab buffer: truncated layer payload.".to_string(),
            ));
        }

        let inner = validate_single_layer_payload(&bytes[cursor..cursor + layer_len])?;
        if inner.width != width
            || inner.height != height
            || inner.anchor_x != anchor_x
            || inner.anchor_y != anchor_y
            || inner.anchor_z != anchor_z
        {
            return Err(SynapseError::Validation(
                "Invalid stacked prefab buffer: inner layer metadata mismatches envelope."
                    .to_string(),
            ));
        }

        max_palette_count = max_palette_count.max(inner.palette_count);
        total_run_count += inner.run_count;
        cursor += layer_len;
    }

    if cursor != bytes.len() {
        return Err(SynapseError::Validation(
            "Invalid stacked prefab buffer: trailing unparsed bytes.".to_string(),
        ));
    }

    Ok(PrefabHeaderMeta {
        width,
        height,
        anchor_x,
        anchor_y,
        anchor_z,
        palette_count: max_palette_count,
        run_count: total_run_count,
    })
}

fn validate_single_layer_payload(bytes: &[u8]) -> Result<PrefabHeaderMeta> {
    if bytes.len() < PREFIX_BYTE_LENGTH {
        return Err(SynapseError::Validation(format!(
            "Invalid prefab buffer: expected at least {} bytes, got {}.",
            PREFIX_BYTE_LENGTH,
            bytes.len()
        )));
    }

    let width = u16::from_le_bytes([bytes[0], bytes[1]]);
    let height = u16::from_le_bytes([bytes[2], bytes[3]]);
    let anchor_x = i16::from_le_bytes([bytes[4], bytes[5]]);
    let anchor_y = i16::from_le_bytes([bytes[6], bytes[7]]);
    let anchor_z = i16::from_le_bytes([bytes[8], bytes[9]]);
    let palette_count = bytes[10];

    let rle_start_offset = PREFIX_BYTE_LENGTH + (palette_count as usize) * PALETTE_ENTRY_BYTE_LENGTH;
    if bytes.len() < rle_start_offset {
        return Err(SynapseError::Validation(format!(
            "Invalid prefab buffer: truncated palette (expected >= {} bytes, got {}).",
            rle_start_offset,
            bytes.len()
        )));
    }

    let rle_byte_length = bytes.len() - rle_start_offset;
    if !rle_byte_length.is_multiple_of(RLE_PAIR_BYTE_LENGTH) {
        return Err(SynapseError::Validation(format!(
            "Invalid prefab buffer: RLE section byte length ({}) must be even.",
            rle_byte_length
        )));
    }

    let run_count = rle_byte_length / RLE_PAIR_BYTE_LENGTH;
    let total_tiles = (width as u64) * (height as u64);
    let max_possible_tiles = (run_count as u64).saturating_mul(MAX_RLE_RUN_LENGTH);

    if total_tiles > max_possible_tiles {
        return Err(SynapseError::Validation(format!(
            "Invalid prefab buffer: dimensions {}x{} ({} tiles) exceed RLE capacity ({}).",
            width, height, total_tiles, max_possible_tiles
        )));
    }

    if total_tiles == 0 {
        if rle_byte_length != 0 {
            return Err(SynapseError::Validation(format!(
                "Invalid prefab buffer: non-empty RLE payload ({} bytes) for zero-area prefab.",
                rle_byte_length
            )));
        }

        return Ok(PrefabHeaderMeta {
            width,
            height,
            anchor_x,
            anchor_y,
            anchor_z,
            palette_count,
            run_count: 0,
        });
    }

    let mut inflated_tiles: u64 = 0;
    let (rle_pairs, _) = bytes[rle_start_offset..].as_chunks::<RLE_PAIR_BYTE_LENGTH>();
    for (pair_idx, &[count, palette_index]) in rle_pairs.iter().enumerate() {
        if count == 0 {
            let offset = rle_start_offset + pair_idx * RLE_PAIR_BYTE_LENGTH;
            return Err(SynapseError::Validation(format!(
                "Invalid prefab RLE run at byte {}: run count must be >= 1.",
                offset
            )));
        }
        if palette_index >= palette_count {
            return Err(SynapseError::Validation(format!(
                "Invalid prefab RLE palette index {} (paletteCount is {}).",
                palette_index, palette_count
            )));
        }

        inflated_tiles += count as u64;
        if inflated_tiles > total_tiles {
            return Err(SynapseError::Validation(format!(
                "Invalid prefab RLE payload: inflated count exceeds {}x{} ({} tiles).",
                width, height, total_tiles
            )));
        }
    }

    if inflated_tiles != total_tiles {
        return Err(SynapseError::Validation(format!(
            "Invalid prefab RLE payload: inflated {} tiles, expected {}.",
            inflated_tiles, total_tiles
        )));
    }

    Ok(PrefabHeaderMeta {
        width,
        height,
        anchor_x,
        anchor_y,
        anchor_z,
        palette_count,
        run_count,
    })
}
