"""Minimal greyscale PNG writer, so the trainer needs no imaging library."""
import struct, zlib


def write_png(path, rows, colour=False):
    """rows: list of bytearray. Greyscale by default, RGB triplets if colour."""
    h = len(rows)
    w = len(rows[0]) // (3 if colour else 1)
    raw = b''.join(b'\x00' + bytes(r) for r in rows)  # filter byte 0 per scanline

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2 if colour else 0, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 6))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
