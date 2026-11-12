use synapse_protocol::prefab::{validate_prefab_payload, PrefabHeaderMeta};
use synapse_protocol::PrefabSummaryDto;

fn build_prefab_payload(
    width: u16,
    height: u16,
    anchor_x: i16,
    anchor_y: i16,
    anchor_z: i16,
    palette: &[u32],
    runs: &[(u8, u8)],
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(11 + palette.len() * 4 + runs.len() * 2);
    buf.extend_from_slice(&width.to_le_bytes());
    buf.extend_from_slice(&height.to_le_bytes());
    buf.extend_from_slice(&anchor_x.to_le_bytes());
    buf.extend_from_slice(&anchor_y.to_le_bytes());
    buf.extend_from_slice(&anchor_z.to_le_bytes());
    buf.push(palette.len() as u8);
    for &asset_id in palette {
        buf.extend_from_slice(&asset_id.to_le_bytes());
    }
    for &(count, palette_idx) in runs {
        buf.push(count);
        buf.push(palette_idx);
    }
    buf
}

#[test]
fn test_validate_prefab_4x4_grid_returns_expected_meta() {
    let payload = build_prefab_payload(
        4,
        4,
        -2,
        3,
        -1,
        &[0x0001_0001, 0x0002_0005],
        &[(15, 0), (1, 1)],
    );

    let meta = validate_prefab_payload(&payload).expect("valid 4x4 prefab should pass");
    assert_eq!(
        meta,
        PrefabHeaderMeta {
            width: 4,
            height: 4,
            anchor_x: -2,
            anchor_y: 3,
            anchor_z: -1,
            palette_count: 2,
            run_count: 2,
        }
    );
}

#[test]
fn test_validate_prefab_0x0_empty_11_bytes() {
    let payload = build_prefab_payload(0, 0, -5, 12, 2, &[], &[]);
    assert_eq!(payload.len(), 11);

    let meta = validate_prefab_payload(&payload).expect("valid 0x0 11-byte prefab should pass");
    assert_eq!(
        meta,
        PrefabHeaderMeta {
            width: 0,
            height: 0,
            anchor_x: -5,
            anchor_y: 12,
            anchor_z: 2,
            palette_count: 0,
            run_count: 0,
        }
    );
}

#[test]
fn test_validate_prefab_300_identical_tiles_split_runs() {
    let payload = build_prefab_payload(
        15,
        20,
        7,
        19,
        0,
        &[0x0003_000A],
        &[(255, 0), (45, 0)],
    );

    let meta = validate_prefab_payload(&payload).expect("300-tile split RLE prefab should pass");
    assert_eq!(
        meta,
        PrefabHeaderMeta {
            width: 15,
            height: 20,
            anchor_x: 7,
            anchor_y: 19,
            anchor_z: 0,
            palette_count: 1,
            run_count: 2,
        }
    );
}

#[test]
fn test_validate_prefab_rejects_fewer_than_11_bytes() {
    assert!(validate_prefab_payload(&[]).is_err());
    assert!(validate_prefab_payload(&[0u8; 10]).is_err());
}

#[test]
fn test_validate_prefab_rejects_truncated_palette() {
    let mut payload = build_prefab_payload(1, 1, 0, 0, 0, &[0x0001_0001], &[]);
    payload[10] = 2;
    assert!(validate_prefab_payload(&payload).is_err());

    let mut partial = build_prefab_payload(1, 1, 0, 0, 0, &[], &[]);
    partial[10] = 1;
    partial.extend_from_slice(&[0x01, 0x02, 0x03]);
    assert!(validate_prefab_payload(&partial).is_err());
}

#[test]
fn test_validate_prefab_rejects_odd_rle_byte_count() {
    let mut payload = build_prefab_payload(1, 1, 0, 0, 0, &[0x0001_0001], &[(1, 0)]);
    payload.push(0x00);
    assert!(validate_prefab_payload(&payload).is_err());
}

#[test]
fn test_validate_prefab_rejects_zero_run_count() {
    let payload = build_prefab_payload(2, 2, 0, 0, 0, &[0x0001_0001], &[(0, 0), (4, 0)]);
    assert!(validate_prefab_payload(&payload).is_err());
}

#[test]
fn test_validate_prefab_rejects_out_of_bounds_palette_index() {
    let payload = build_prefab_payload(
        2,
        2,
        0,
        0,
        0,
        &[0x0001_0001, 0x0002_0002],
        &[(4, 2)],
    );
    assert!(validate_prefab_payload(&payload).is_err());
}

#[test]
fn test_validate_prefab_rejects_inflated_tile_count_mismatch() {
    let underflow = build_prefab_payload(4, 4, 0, 0, 0, &[0x0001_0001], &[(15, 0)]);
    assert!(validate_prefab_payload(&underflow).is_err());

    let overflow = build_prefab_payload(4, 4, 0, 0, 0, &[0x0001_0001], &[(10, 0), (7, 0)]);
    assert!(validate_prefab_payload(&overflow).is_err());

    let zero_area_with_rle = build_prefab_payload(0, 0, 0, 0, 0, &[0x0001_0001], &[(1, 0)]);
    assert!(validate_prefab_payload(&zero_area_with_rle).is_err());
}

#[test]
fn test_validate_prefab_rejects_oom_dimensions() {
    let payload = build_prefab_payload(65535, 65535, 0, 0, 0, &[0x0001_0001], &[(1, 0)]);
    assert!(validate_prefab_payload(&payload).is_err());
}

#[test]
fn test_prefab_summary_dto_json_round_trip() {
    let dto = PrefabSummaryDto {
        id: 42,
        name: "Starter House".to_string(),
        width: 12,
        height: 8,
        anchor_x: -6,
        anchor_y: 7,
        anchor_z: -1,
        byte_length: 128,
        created_at: "2026-11-12T12:00:00Z".to_string(),
    };

    let json = serde_json::to_string(&dto).expect("serialize PrefabSummaryDto");
    let decoded: PrefabSummaryDto =
        serde_json::from_str(&json).expect("deserialize PrefabSummaryDto");

    assert_eq!(decoded.id, 42);
    assert_eq!(decoded.name, "Starter House");
    assert_eq!(decoded.width, 12);
    assert_eq!(decoded.height, 8);
    assert_eq!(decoded.anchor_x, -6);
    assert_eq!(decoded.anchor_y, 7);
    assert_eq!(decoded.anchor_z, -1);
    assert_eq!(decoded.byte_length, 128);
    assert_eq!(decoded.created_at, "2026-11-12T12:00:00Z");
}

#[test]
fn test_validate_stacked_prefab_sps1_payload() {
    let layer0 = build_prefab_payload(2, 2, 1, 1, -1, &[0x0001_0001], &[(4, 0)]);
    let layer1 = build_prefab_payload(2, 2, 1, 1, -1, &[0, 0x0006_0002], &[(1, 0), (1, 1), (2, 0)]);

    let mut stacked = Vec::new();
    stacked.extend_from_slice(b"SPS\x01");
    stacked.extend_from_slice(&2u16.to_le_bytes()); // layer_count
    stacked.extend_from_slice(&2u16.to_le_bytes()); // width
    stacked.extend_from_slice(&2u16.to_le_bytes()); // height
    stacked.extend_from_slice(&1i16.to_le_bytes()); // anchor_x
    stacked.extend_from_slice(&1i16.to_le_bytes()); // anchor_y
    stacked.extend_from_slice(&(-1i16).to_le_bytes()); // anchor_z

    stacked.extend_from_slice(&(-1i16).to_le_bytes()); // rel_z -1 (under)
    stacked.extend_from_slice(&(layer0.len() as u32).to_le_bytes());
    stacked.extend_from_slice(&layer0);

    stacked.extend_from_slice(&2i16.to_le_bytes()); // rel_z +2 (worldZ = +1, over)
    stacked.extend_from_slice(&(layer1.len() as u32).to_le_bytes());
    stacked.extend_from_slice(&layer1);

    let meta = validate_prefab_payload(&stacked).expect("valid stacked SPS\\x01 payload should pass");
    assert_eq!(meta.width, 2);
    assert_eq!(meta.height, 2);
    assert_eq!(meta.anchor_x, 1);
    assert_eq!(meta.anchor_y, 1);
    assert_eq!(meta.anchor_z, -1);
    assert_eq!(meta.palette_count, 2);
    assert_eq!(meta.run_count, 4);
}

#[test]
fn test_validate_stacked_prefab_rejects_corrupt_or_mismatched_layers() {
    let mut zero_layers = Vec::new();
    zero_layers.extend_from_slice(b"SPS\x01");
    zero_layers.extend_from_slice(&0u16.to_le_bytes());
    zero_layers.extend_from_slice(&2u16.to_le_bytes());
    zero_layers.extend_from_slice(&2u16.to_le_bytes());
    zero_layers.extend_from_slice(&0i16.to_le_bytes());
    zero_layers.extend_from_slice(&0i16.to_le_bytes());
    zero_layers.extend_from_slice(&0i16.to_le_bytes());
    assert!(validate_prefab_payload(&zero_layers).is_err());

    let inner_1x1 = build_prefab_payload(1, 1, 0, 0, 0, &[10], &[(1, 0)]);
    let mut mismatched = Vec::new();
    mismatched.extend_from_slice(b"SPS\x01");
    mismatched.extend_from_slice(&1u16.to_le_bytes());
    mismatched.extend_from_slice(&2u16.to_le_bytes());
    mismatched.extend_from_slice(&2u16.to_le_bytes());
    mismatched.extend_from_slice(&0i16.to_le_bytes());
    mismatched.extend_from_slice(&0i16.to_le_bytes());
    mismatched.extend_from_slice(&0i16.to_le_bytes());
    mismatched.extend_from_slice(&0i16.to_le_bytes());
    mismatched.extend_from_slice(&(inner_1x1.len() as u32).to_le_bytes());
    mismatched.extend_from_slice(&inner_1x1);
    assert!(validate_prefab_payload(&mismatched).is_err());
}
