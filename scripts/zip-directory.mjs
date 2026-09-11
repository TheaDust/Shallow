import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[index]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function dosTimestamp(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day =
    ((Math.max(1980, date.getFullYear()) - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

async function collectEntries(root, excluded) {
  const entries = [];
  async function walk(directory) {
    const children = (await readdir(directory, { withFileTypes: true })).sort(
      (left, right) => (left.name < right.name ? -1 : 1),
    );
    for (const child of children) {
      const absolute = join(directory, child.name);
      if (resolve(absolute) === excluded) continue;
      const name = relative(root, absolute).split(sep).join("/");
      if (child.isDirectory()) {
        entries.push({ name: `${name}/`, absolute, directory: true });
        await walk(absolute);
      } else if (child.isFile()) {
        entries.push({ name, absolute, directory: false });
      } else {
        throw new Error(`Unsupported entry in package: ${absolute}`);
      }
    }
  }
  await walk(root);
  return entries;
}

export async function zipDirectory(sourceDirectory, zipPath) {
  const root = resolve(sourceDirectory);
  const entries = await collectEntries(root, resolve(zipPath));
  const dataChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const info = await stat(entry.absolute);
    const { time, day } = dosTimestamp(info.mtime);
    let content = Buffer.alloc(0);
    let compressed = Buffer.alloc(0);
    let method = 0;
    let crc = 0;
    if (!entry.directory) {
      content = await readFile(entry.absolute);
      crc = crc32(content);
      compressed = deflateRawSync(content, { level: 9 });
      method = 8;
    }
    const name = Buffer.from(entry.name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    dataChunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.directory ? 0x10 : 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(zipPath, Buffer.concat([...dataChunks, centralDirectory, end]));
}
