import struct
import gzip

with open('/Users/sacrtap/Documents/project_work/3dgs/apps/demo/public/kitchen.sog', 'rb') as f:
    header = f.read(64)

    print('SOG Header Analysis:')
    print('=' * 50)
    magic = struct.unpack('<I', header[0:4])[0]
    print(f'Magic: 0x{magic:08X}')
    version_field = struct.unpack('<H', header[4:6])[0]
    print(f'Version field: {version_field}')
    sh_degree = header[6]
    print(f'SH Degree (byte 6): {sh_degree}')
    compression = header[7]
    print(f'Compression (byte 7): {compression}')
    num_splats = struct.unpack('<I', header[8:12])[0]
    print(f'Num Splats: {num_splats}')
    num_chunks = struct.unpack('<I', header[12:16])[0]
    print(f'Num Chunks: {num_chunks}')
    chunk_size = struct.unpack('<I', header[16:20])[0]
    print(f'Chunk Size: {chunk_size}')
    bbox_min = struct.unpack('<fff', header[20:32])
    print(f'BBox Min: {bbox_min}')
    bbox_max = struct.unpack('<fff', header[32:44])
    print(f'BBox Max: {bbox_max}')
    lod_quality = header[52]
    print(f'LOD Quality (byte 52): {lod_quality}')
    pos_quant = header[53]
    print(f'Position Quant (byte 53): {pos_quant}')
    f.seek(64)
    index_data = f.read(num_chunks * 8)
    print(f'Chunk index size: {len(index_data)} bytes')
    for i in range(min(3, num_chunks)):
        offset = struct.unpack('<I', index_data[i*8:i*8+4])[0]
        size = struct.unpack('<I', index_data[i*8+4:i*8+8])[0]
        print(f'  Chunk {i}: offset={offset}, size={size}')

    # Check first chunk data
    print('\nFirst Chunk Analysis:')
    print('=' * 50)
    first_offset = struct.unpack('<I', index_data[0:4])[0]
    first_size = struct.unpack('<I', index_data[4:8])[0]
    print(f'Chunk 0: offset={first_offset}, size={first_size}')

    f.seek(first_offset)
    chunk_data = f.read(first_size)
    print(f'Raw chunk data size: {len(chunk_data)} bytes')

    # Try decompress
    try:
        decompressed = gzip.decompress(chunk_data)
        print(f'Decompressed size: {len(decompressed)} bytes')
        print(f'Expected for 16384 splats @ 32B: {16384 * 32} bytes')

        # Parse first splat to verify format (.splat format: 32 bytes)
        # Position (12B: 3x float32), Scale (12B: 3x float32), Color (4B: 4x uint8), Rotation (4B: 4x uint8)
        print('\nFirst Splat Data (32 bytes):')
        pos = struct.unpack('<fff', decompressed[0:12])
        scale = struct.unpack('<fff', decompressed[12:24])
        color = struct.unpack('<BBBB', decompressed[24:28])
        rot = struct.unpack('<BBBB', decompressed[28:32])
        print(f'  Position XYZ: {pos[0]:.4f}, {pos[1]:.4f}, {pos[2]:.4f}')
        print(f'  Scale XYZ: {scale[0]:.4f}, {scale[1]:.4f}, {scale[2]:.4f}')
        print(f'  Color RGBA: {color[0]}, {color[1]}, {color[2]}, {color[3]}')
        print(f'  Rotation: {rot[0]}, {rot[1]}, {rot[2]}, {rot[3]}')

        # Check if position is reasonable
        pos_x, pos_y, pos_z = pos[0], pos[1], pos[2]
        print(f'\nPosition within bbox?')
        print(f'  X: {bbox_min[0]:.2f} <= {pos_x:.2f} <= {bbox_max[0]:.2f} ? {bbox_min[0] <= pos_x <= bbox_max[0]}')
        print(f'  Y: {bbox_min[1]:.2f} <= {pos_y:.2f} <= {bbox_max[1]:.2f} ? {bbox_min[1] <= pos_y <= bbox_max[1]}')
        print(f'  Z: {bbox_min[2]:.2f} <= {pos_z:.2f} <= {bbox_max[2]:.2f} ? {bbox_min[2] <= pos_z <= bbox_max[2]}')

    except Exception as e:
        print(f'Decompress error: {e}')
