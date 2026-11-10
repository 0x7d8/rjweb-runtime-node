import { Readable, Writable, pipeline } from "stream"
import { availableParallelism } from "os"
import * as zlib from "zlib"

const errFn = () => undefined

const brotliOptions: zlib.BrotliOptions = {
	params: {
		[zlib.constants.BROTLI_PARAM_QUALITY]: 4
	}
}

const inlineMaxSize = availableParallelism() > 1 ? 4096 : 32768

export function compressionStream(method: 'gzip' | 'brotli' | 'deflate' | null, source: Readable, destination: Writable): void {
	switch (method) {
		case "gzip":
			pipeline(source, zlib.createGzip(), destination, errFn)
			break
		case "brotli":
			pipeline(source, zlib.createBrotliCompress(brotliOptions), destination, errFn)
			break
		case "deflate":
			pipeline(source, zlib.createDeflate(), destination, errFn)
			break
		case null:
			pipeline(source, destination, errFn)
			break
	}
}

export function compressionSync(method: 'gzip' | 'brotli' | 'deflate' | null, data: ArrayBuffer | Buffer): Buffer | Promise<Buffer> {
	const inline = data.byteLength <= inlineMaxSize

	switch (method) {
		case "gzip":
			if (inline) return zlib.gzipSync(data)
			return new Promise((resolve, reject) => zlib.gzip(data, (err, result) => err ? reject(err) : resolve(result)))
		case "brotli":
			if (inline) return zlib.brotliCompressSync(data, brotliOptions)
			return new Promise((resolve, reject) => zlib.brotliCompress(data, brotliOptions, (err, result) => err ? reject(err) : resolve(result)))
		case "deflate":
			if (inline) return zlib.deflateSync(data)
			return new Promise((resolve, reject) => zlib.deflate(data, (err, result) => err ? reject(err) : resolve(result)))
		case null:
			return Buffer.isBuffer(data) ? data : Buffer.from(data)
	}
}
