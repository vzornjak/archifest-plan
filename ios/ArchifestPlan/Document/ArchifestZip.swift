// ArchifestZip — a real .zip writer/reader, hand-rolled with no third-party
// library, on purpose: the project has a hard "no dependencies" rule for the
// web app, and the owner asked to keep that value for the iOS side too.
// iOS has no public API to create a real zip (confirmed: even Files app's
// own "Compress" uses a private framework third-party apps can't call).
//
// Deliberately narrow: this only needs to write/read a handful of small
// JSON entries (scan.json, meta.json) into a document a person can rename
// to .zip and open with any unzip tool. So: single disk, STORE only (no
// DEFLATE — these files are a few KB, compression buys nothing worth the
// extra risk of getting raw-deflate framing subtly wrong), no directories,
// no Zip64, no encryption. Not a general-purpose zip library.
//
// Verified independently of Xcode/Simulator: round-tripped against macOS's
// real `zip`/`unzip` CLI before ever being wired into the app (see the PR
// description / CLAUDE.md for how).
import Foundation

enum ArchifestZipError: Error, CustomStringConvertible {
  case invalidArchive(String)
  var description: String {
    switch self {
    case .invalidArchive(let reason): return "invalid zip archive: \(reason)"
    }
  }
}

enum ArchifestZip {
  struct Entry {
    let name: String
    let data: Data
  }

  // MARK: - Write

  static func write(entries: [Entry], to url: URL) throws {
    try data(for: entries).write(to: url, options: .atomic)
  }

  static func data(for entries: [Entry]) -> Data {
    var body = Data()
    struct Rec { let name: String; let crc: UInt32; let size: UInt32; let offset: UInt32 }
    var records: [Rec] = []
    let (dosTime, dosDate) = dosDateTime(from: Date())

    for entry in entries {
      let nameBytes = Data(entry.name.utf8)
      let crc = CRC32.checksum(entry.data)
      let offset = UInt32(body.count)

      var header = Data()
      header.appendUInt32LE(0x0403_4b50) // local file header signature
      header.appendUInt16LE(20)          // version needed to extract (2.0)
      header.appendUInt16LE(0x0800)      // general purpose flag: UTF-8 names
      header.appendUInt16LE(0)           // compression method: store
      header.appendUInt16LE(dosTime)
      header.appendUInt16LE(dosDate)
      header.appendUInt32LE(crc)
      header.appendUInt32LE(UInt32(entry.data.count)) // compressed size
      header.appendUInt32LE(UInt32(entry.data.count)) // uncompressed size
      header.appendUInt16LE(UInt16(nameBytes.count))
      header.appendUInt16LE(0) // extra field length
      header.append(nameBytes)

      body.append(header)
      body.append(entry.data)
      records.append(Rec(name: entry.name, crc: crc, size: UInt32(entry.data.count), offset: offset))
    }

    var central = Data()
    for r in records {
      let nameBytes = Data(r.name.utf8)
      var rec = Data()
      rec.appendUInt32LE(0x0201_4b50) // central directory header signature
      rec.appendUInt16LE(20) // version made by
      rec.appendUInt16LE(20) // version needed to extract
      rec.appendUInt16LE(0x0800)
      rec.appendUInt16LE(0) // method: store
      rec.appendUInt16LE(dosTime)
      rec.appendUInt16LE(dosDate)
      rec.appendUInt32LE(r.crc)
      rec.appendUInt32LE(r.size)
      rec.appendUInt32LE(r.size)
      rec.appendUInt16LE(UInt16(nameBytes.count))
      rec.appendUInt16LE(0) // extra field length
      rec.appendUInt16LE(0) // comment length
      rec.appendUInt16LE(0) // disk number start
      rec.appendUInt16LE(0) // internal file attributes
      rec.appendUInt32LE(0) // external file attributes
      rec.appendUInt32LE(r.offset)
      rec.append(nameBytes)
      central.append(rec)
    }

    var eocd = Data()
    eocd.appendUInt32LE(0x0605_4b50) // end of central directory signature
    eocd.appendUInt16LE(0) // this disk number
    eocd.appendUInt16LE(0) // disk where central directory starts
    eocd.appendUInt16LE(UInt16(records.count)) // records on this disk
    eocd.appendUInt16LE(UInt16(records.count)) // total records
    eocd.appendUInt32LE(UInt32(central.count)) // central directory size
    eocd.appendUInt32LE(UInt32(body.count))    // central directory offset
    eocd.appendUInt16LE(0) // comment length

    var full = Data()
    full.append(body)
    full.append(central)
    full.append(eocd)
    return full
  }

  // MARK: - Read

  static func read(from url: URL) throws -> [String: Data] {
    try read(Data(contentsOf: url))
  }

  static func read(_ archive: Data) throws -> [String: Data] {
    guard archive.count >= 22 else { throw ArchifestZipError.invalidArchive("file too small to be a zip") }

    // The end-of-central-directory record is at the tail, but a (rare, here
    // always-empty) comment can push it earlier — scan backward for its
    // signature rather than assuming a fixed offset.
    let scanFloor = max(0, archive.count - 22 - 65535)
    var eocdOffset: Int? = nil
    var i = archive.count - 22
    while i >= scanFloor {
      if readUInt32LE(archive, i) == 0x0605_4b50 { eocdOffset = i; break }
      i -= 1
    }
    guard let eocd = eocdOffset else {
      throw ArchifestZipError.invalidArchive("end-of-central-directory record not found")
    }

    let entryCount = Int(readUInt16LE(archive, eocd + 10))
    let centralDirectoryOffset = Int(readUInt32LE(archive, eocd + 16))

    // Every offset below comes from inside the file being read, so a
    // truncated or hand-edited archive can point anywhere. Data's subscript
    // and subdata TRAP on an out-of-range index rather than throwing — that
    // would be a hard crash on a merely corrupt file, which for a document
    // the user can receive from anywhere is not acceptable. `require`
    // converts every such read into a thrown, catchable error.
    func require(_ condition: Bool, _ reason: String) throws {
      if !condition { throw ArchifestZipError.invalidArchive(reason) }
    }
    /// Range must lie entirely within the archive, and not be inverted by an
    /// absurd length read out of a corrupt header.
    func requireRange(_ start: Int, _ length: Int, _ what: String) throws {
      try require(
        start >= 0 && length >= 0 && start <= archive.count && length <= archive.count - start,
        "\(what) points outside the file — archive is truncated or corrupt"
      )
    }

    var result: [String: Data] = [:]
    var p = centralDirectoryOffset
    for _ in 0..<entryCount {
      try requireRange(p, 46, "central directory entry")
      guard readUInt32LE(archive, p) == 0x0201_4b50 else {
        throw ArchifestZipError.invalidArchive("malformed central directory entry")
      }
      let method = readUInt16LE(archive, p + 10)
      let compressedSize = Int(readUInt32LE(archive, p + 20))
      let uncompressedSize = Int(readUInt32LE(archive, p + 24))
      let nameLength = Int(readUInt16LE(archive, p + 28))
      let extraLength = Int(readUInt16LE(archive, p + 30))
      let commentLength = Int(readUInt16LE(archive, p + 32))
      let localHeaderOffset = Int(readUInt32LE(archive, p + 42))
      let nameStart = p + 46
      try requireRange(nameStart, nameLength, "entry name")
      let name = String(
        data: archive.subdata(in: nameStart..<(nameStart + nameLength)),
        encoding: .utf8
      ) ?? ""
      p = nameStart + nameLength + extraLength + commentLength

      try requireRange(localHeaderOffset, 30, "local file header for \(name)")
      guard readUInt32LE(archive, localHeaderOffset) == 0x0403_4b50 else {
        throw ArchifestZipError.invalidArchive("malformed local file header for \(name)")
      }
      let localNameLength = Int(readUInt16LE(archive, localHeaderOffset + 26))
      let localExtraLength = Int(readUInt16LE(archive, localHeaderOffset + 28))
      let dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      try requireRange(dataStart, compressedSize, "entry data for \(name)")
      let compressedData = archive.subdata(in: dataStart..<(dataStart + compressedSize))

      let entryData: Data
      switch method {
      case 0: entryData = compressedData // stored
      default:
        throw ArchifestZipError.invalidArchive("unsupported compression method \(method) for \(name) — only store (0) is written by this app, but this reader may be handed a zip made elsewhere")
      }
      guard entryData.count == uncompressedSize else {
        throw ArchifestZipError.invalidArchive("size mismatch for \(name)")
      }
      guard CRC32.checksum(entryData) == readUInt32LE(archive, localHeaderOffset + 14) else {
        throw ArchifestZipError.invalidArchive("CRC-32 mismatch for \(name) — file may be corrupt")
      }
      result[name] = entryData
    }
    return result
  }

  // MARK: - Helpers

  private static func dosDateTime(from date: Date) -> (time: UInt16, date: UInt16) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
    let c = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    let year = max(1980, c.year ?? 1980)
    let dosDate = UInt16(((year - 1980) << 9) | ((c.month ?? 1) << 5) | (c.day ?? 1))
    let dosTime = UInt16(((c.hour ?? 0) << 11) | ((c.minute ?? 0) << 5) | ((c.second ?? 0) / 2))
    return (dosTime, dosDate)
  }

  private static func readUInt16LE(_ d: Data, _ offset: Int) -> UInt16 {
    let base = d.startIndex + offset
    return UInt16(d[base]) | (UInt16(d[base + 1]) << 8)
  }

  private static func readUInt32LE(_ d: Data, _ offset: Int) -> UInt32 {
    let base = d.startIndex + offset
    return UInt32(d[base])
      | (UInt32(d[base + 1]) << 8)
      | (UInt32(d[base + 2]) << 16)
      | (UInt32(d[base + 3]) << 24)
  }
}

private extension Data {
  mutating func appendUInt16LE(_ v: UInt16) {
    append(UInt8(v & 0xFF))
    append(UInt8((v >> 8) & 0xFF))
  }
  mutating func appendUInt32LE(_ v: UInt32) {
    append(UInt8(v & 0xFF))
    append(UInt8((v >> 8) & 0xFF))
    append(UInt8((v >> 16) & 0xFF))
    append(UInt8((v >> 24) & 0xFF))
  }
}

/// Standard IEEE 802.3 CRC-32, table-based — zip's per-entry integrity check.
enum CRC32 {
  private static let table: [UInt32] = (0..<256).map { i -> UInt32 in
    var c = UInt32(i)
    for _ in 0..<8 {
      c = (c & 1 != 0) ? (0xEDB8_8320 ^ (c >> 1)) : (c >> 1)
    }
    return c
  }

  static func checksum(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    for byte in data {
      let index = Int((crc ^ UInt32(byte)) & 0xFF)
      crc = table[index] ^ (crc >> 8)
    }
    return crc ^ 0xFFFF_FFFF
  }
}
