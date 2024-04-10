import { Readable, Writable, pipeline } from "stream"
import * as zlib from "zlib"

const errFn = () => undefined

export function compressionStream(method: 'gzip' | 'brotli' | 'deflate' | null, source: Readable, destination: Writable): void {
	switch (method) {
		case "gzip":
			pipeline(source, zlib.createGzip(), destination, errFn)
			break
		case "brotli":
			pipeline(source, zlib.createBrotliCompress(), destination, errFn)
			break
		case "deflate":
			pipeline(source, zlib.createDeflate(), destination, errFn)
			break
		case null:
			pipeline(source, destination, errFn)
			break
	}
}

export function compressionSync(method: 'gzip' | 'brotli' | 'deflate' | null, data: ArrayBuffer): Promise<Buffer> {
	switch (method) {
		case "gzip":
			return new Promise((resolve, reject) => zlib.gzip(data, (err, result) => err ? reject(err) : resolve(result)))
		case "brotli":
			return new Promise((resolve, reject) => zlib.brotliCompress(data, (err, result) => err ? reject(err) : resolve(result)))
		case "deflate":
			return new Promise((resolve, reject) => zlib.deflate(data, (err, result) => err ? reject(err) : resolve(result)))
		case null:
			return Promise.resolve(Buffer.from(data))
	}
}