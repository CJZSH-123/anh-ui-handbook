# -*- coding: utf-8 -*-
"""Minimal OLE/CFB + Word 97-2003 (.doc) text extractor.

No external dependencies: parses the compound file container, the FIB and the
piece table (Clx/PlcPcd) inside the WordDocument stream, then decodes each text
piece as UTF-16LE or as single-byte text in the document code page.
"""

import struct
import sys

ENDOFCHAIN = 0xFFFFFFFE
FREESECT = 0xFFFFFFFF


class Cfb:
    def __init__(self, data):
        self.data = data
        if data[:8] != bytes.fromhex("D0CF11E0A1B11AE1"):
            raise ValueError("not an OLE2 compound file")
        self.sector_size = 1 << struct.unpack_from("<H", data, 0x1E)[0]
        self.mini_size = 1 << struct.unpack_from("<H", data, 0x20)[0]
        self.num_fat = struct.unpack_from("<I", data, 0x2C)[0]
        self.dir_start = struct.unpack_from("<I", data, 0x30)[0]
        self.mini_cutoff = struct.unpack_from("<I", data, 0x38)[0]
        self.minifat_start = struct.unpack_from("<I", data, 0x3C)[0]
        self.num_minifat = struct.unpack_from("<I", data, 0x40)[0]
        difat_start = struct.unpack_from("<I", data, 0x44)[0]
        self.num_difat = struct.unpack_from("<I", data, 0x48)[0]
        self._load_fat(difat_start)
        self._load_minifat()
        self._load_directory()

    def _off(self, sector):
        return (sector + 1) * self.sector_size

    def _sector(self, sector):
        start = self._off(sector)
        return self.data[start:start + self.sector_size]

    def _load_fat(self, difat_start):
        per_sector = self.sector_size // 4
        difat = list(struct.unpack_from("<109I", self.data, 0x4C))
        fat_sectors = [s for s in difat if s < 0xFFFFFFFA]
        nxt = difat_start
        guard = 0
        while nxt < 0xFFFFFFFA and guard < 4096:
            entries = list(struct.unpack_from("<%dI" % per_sector, self.data, self._off(nxt)))
            fat_sectors.extend(s for s in entries[:-1] if s < 0xFFFFFFFA)
            nxt = entries[-1]
            guard += 1
        fat = []
        for s in fat_sectors:
            fat.extend(struct.unpack_from("<%dI" % per_sector, self.data, self._off(s)))
        self.fat = fat

    def _load_minifat(self):
        per_sector = self.sector_size // 4
        raw = self._read_chain(self.minifat_start)
        self.minifat = list(struct.unpack_from("<%dI" % (len(raw) // 4), raw, 0)) if raw else []
        del per_sector

    def _load_directory(self):
        raw = self._read_chain(self.dir_start)
        self.entries = []
        for i in range(0, len(raw) - 127, 128):
            e = raw[i:i + 128]
            name_len = struct.unpack_from("<H", e, 0x40)[0]
            name = ""
            if name_len >= 2:
                name = e[:name_len - 2].decode("utf-16-le", "replace")
            self.entries.append({
                "name": name,
                "type": e[0x42],
                "start": struct.unpack_from("<I", e, 0x74)[0],
                "size": struct.unpack_from("<Q", e, 0x78)[0],
            })

    def _read_chain(self, start, fat=None):
        fat = self.fat if fat is None else fat
        out = bytearray()
        seen = set()
        cur = start
        while cur < 0xFFFFFFFA:
            if cur in seen or cur >= len(fat):
                break
            seen.add(cur)
            out += self._sector(cur)
            cur = fat[cur]
        return bytes(out)

    def stream(self, name):
        for e in self.entries:
            if e["name"] == name and e["type"] == 2:
                return self._stream_data(e)
        return None

    def _stream_data(self, entry):
        size = entry["size"]
        if size < self.mini_cutoff:
            root = next(e for e in self.entries if e["name"] == "Root Entry")
            mini = self._read_chain(root["start"])
            out = bytearray()
            cur = entry["start"]
            seen = set()
            while cur < 0xFFFFFFFA and cur not in seen:
                seen.add(cur)
                start = cur * self.mini_size
                out += mini[start:start + self.mini_size]
                if cur >= len(self.minifat):
                    break
                cur = self.minifat[cur]
            return bytes(out[:size])
        return self._read_chain(entry["start"])[:size]


def fib_table_stream(data):
    flags = struct.unpack_from("<H", data, 0x0A)[0]
    return "1Table" if flags & 0x0200 else "0Table"


def extract_text(cfb, codepage="cp936"):
    word_doc = cfb.stream("WordDocument")
    if word_doc is None:
        raise ValueError("WordDocument stream missing")
    table = cfb.stream(fib_table_stream(word_doc))
    if table is None:
        raise ValueError("table stream missing")

    fc_clx, lcb_clx = struct.unpack_from("<II", word_doc, 0x01A2)
    clx = table[fc_clx:fc_clx + lcb_clx]

    # Walk the Clx: zero or more Prc records, then the Pcdt holding the piece table.
    pos = 0
    pcdt = None
    while pos < len(clx):
        marker = clx[pos]
        if marker == 0x01:
            cb = struct.unpack_from("<h", clx, pos + 1)[0]
            pos += 3 + cb
        elif marker == 0x02:
            lcb = struct.unpack_from("<I", clx, pos + 1)[0]
            pcdt = clx[pos + 5:pos + 5 + lcb]
            break
        else:
            break
    if pcdt is None:
        raise ValueError("piece table not found")

    n = (len(pcdt) - 4) // 12
    cps = list(struct.unpack_from("<%dI" % (n + 1), pcdt, 0))
    pieces = []
    for i in range(n):
        off = 4 * (n + 1) + i * 8
        fc = struct.unpack_from("<I", pcdt, off + 2)[0]
        compressed = bool(fc & 0x40000000)
        base = fc & 0x3FFFFFFF
        char_count = cps[i + 1] - cps[i]
        if compressed:
            raw = word_doc[base // 2: base // 2 + char_count]
            text = raw.decode(codepage, "replace")
        else:
            raw = word_doc[base: base + char_count * 2]
            text = raw.decode("utf-16-le", "replace")
        pieces.append(text)
    return "".join(pieces)


def normalize(text):
    # 0x07 ends a table cell/row, 0x0D ends a paragraph, 0x0B is a manual break.
    out = text.replace("\x07", "\n").replace("\x0b", "\n").replace("\x0c", "\n")
    out = out.replace("\x1e", "-").replace("\x1f", "")
    out = out.replace("\r\n", "\n").replace("\r", "\n")
    out = out.replace("\x13", "").replace("\x14", "").replace("\x15", "")
    lines = [ln.rstrip() for ln in out.split("\n")]
    return "\n".join(lines)


def main():
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else None
    with open(src, "rb") as fh:
        cfb = Cfb(fh.read())
    if "--list" in sys.argv:
        for e in cfb.entries:
            if e["type"] != 0:
                print(e["type"], repr(e["name"]), e["size"])
        return
    text = normalize(extract_text(cfb))
    if dst:
        with open(dst, "w", encoding="utf-8") as fh:
            fh.write(text)
        print("chars:", len(text))
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(text)


if __name__ == "__main__":
    main()
