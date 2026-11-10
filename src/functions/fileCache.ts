export type FileStat = {
	size: number
	mtimeMs: number
	ino: number
}

export type CachedFile = FileStat & {
	data: Buffer
	gzip: Buffer | null
	brotli: Buffer | null
	deflate: Buffer | null
}

export const maxFileSize = 64 * 1024
const maxTotalSize = 32 * 1024 * 1024

const files = new Map<string, CachedFile>()
let totalSize = 0

function entrySize(entry: CachedFile): number {
	return entry.data.byteLength + (entry.gzip?.byteLength ?? 0) + (entry.brotli?.byteLength ?? 0) + (entry.deflate?.byteLength ?? 0)
}

function evict(): void {
	for (const [ file, entry ] of files) {
		if (totalSize <= maxTotalSize) break

		files.delete(file)
		totalSize -= entrySize(entry)
	}
}

export function getFile(file: string, stat: FileStat): CachedFile | null {
	const entry = files.get(file)
	if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size || entry.ino !== stat.ino) return null

	return entry
}

export function storeFile(file: string, stat: FileStat, data: Buffer): CachedFile {
	const old = files.get(file)
	if (old) {
		files.delete(file)
		totalSize -= entrySize(old)
	}

	const entry: CachedFile = { size: stat.size, mtimeMs: stat.mtimeMs, ino: stat.ino, data, gzip: null, brotli: null, deflate: null }

	files.set(file, entry)
	totalSize += data.byteLength
	evict()

	return entry
}

export function storeCompressed(file: string, entry: CachedFile, method: 'gzip' | 'brotli' | 'deflate', data: Buffer): void {
	if (files.get(file) !== entry || entry[method]) return

	entry[method] = data
	totalSize += data.byteLength
	evict()
}
