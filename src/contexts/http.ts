import { ImplementationHttpContext, Method, ValueCollection, ImplementationWebsocketData } from "rjweb-server"
import { WebSocketServer } from "ws"
import { Duplex, Readable } from "stream"
import { IncomingMessage, ServerResponse } from "http"
import * as fs from "fs"
import { WsContext, subscriberCollection } from "@/contexts/ws"
import { as, number } from "@rjweb/utils"
import { compressionStream, compressionSync } from "@/functions/compression"
import { type CachedFile, type FileStat, getFile, maxFileSize, storeCompressed, storeFile } from "@/functions/fileCache"

export type Serve = {
	http: (context: HttpContext) => Promise<void>,
	websocket: {
		message: (context: WsContext) => Promise<void>,
		open: (context: WsContext) => Promise<void>,
		close: (context: WsContext) => Promise<void>
	}
}

const noop = () => {}
const fromObject: (<Key extends PropertyKey, Value>(data: Record<Key, Value>) => ValueCollection<Key, Value>) | undefined = as<any>(ValueCollection).fromObject

function writeRawHeaders(stream: Duplex, headers: Record<string, string | string[]>): void {
	for (const key in headers) {
		const values = headers[key]

		if (typeof values === 'string') stream.write(`${key}: ${values}\r\n`)
		else for (const value of values) {
			stream.write(`${key}: ${value}\r\n`)
		}
	}
}

export class HttpContext extends ImplementationHttpContext {
	private abortController: AbortController | null = null
	private statusCode = 200
	private statusMessage = 'OK'
	private responseHeaders: Record<string, string | string[]> = {}

	constructor(private req: IncomingMessage, private res: (ServerResponse<IncomingMessage> & { req: IncomingMessage }) | Duplex, private server: WebSocketServer, private serve: Serve, private head: Buffer | null, private fileCache: boolean = true) {
		super()

		res.on('error', noop)
	}

	public aborted(): AbortSignal {
		if (this.abortController) return this.abortController.signal

		const controller = new AbortController(), res = this.res
		this.abortController = controller

		if (this.isAborted()) controller.abort()
		else if (this.head === null) {
			res.once('close', () => {
				if (!res.writableFinished) controller.abort()
			})
		} else {
			res.once('close', () => controller.abort())
		}

		return controller.signal
	}

	public isAborted(): boolean {
		if (this.head === null) return this.res.closed && !this.res.writableFinished

		return this.res.closed
	}

	public type(): 'http' | 'ws' {
		return this.head === null ? 'http' : 'ws'
	}

	public method(): Method {
		return this.req.method ?? 'GET' as any
	}

	public path(): string {
		return this.req.url ?? '/'
	}

	public clientIP(): string {
		return this.req.socket.remoteAddress ?? '127.0.0.1'
	}

	public clientPort(): number {
		return this.req.socket.remotePort ?? 0
	}

	public async onBodyChunk(callback: (chunk: ArrayBuffer, isLast: boolean) => Promise<any>): Promise<void> {
		if (!this.req.readable) {
			callback(Buffer.allocUnsafe(0).buffer as ArrayBuffer, true)
			return
		}

		return new Promise((resolve) => {
			this.req.on('data', async(chunk) => {
				this.req.pause()

				await callback(chunk, false)
				this.req.resume()
			})

			this.req.once('end', async() => {
				await callback(Buffer.allocUnsafe(0).buffer as ArrayBuffer, true)
				resolve()
			})
		})
	}

	public getHeaders(): ValueCollection<string, string> {
		return fromObject ? fromObject(this.req.headers as any) : new ValueCollection(this.req.headers as any)
	}

	public status(code: number, message: string): this {
		this.statusCode = code
		this.statusMessage = message

		return this
	}

	public header(key: string, value: string): this {
		const existing = this.responseHeaders[key]

		if (existing === undefined) this.responseHeaders[key] = value
		else if (typeof existing === 'string') this.responseHeaders[key] = [ existing, value ]
		else existing.push(value)

		return this
	}

	public async write(data: ArrayBuffer | Readable): Promise<void> {
		if (this.res.closed) return

		const compression = this.getCompression()
		let compressed: Buffer | null = null

		if (data instanceof ArrayBuffer) {
			const result = compressionSync(compression, data)

			if (Buffer.isBuffer(result)) compressed = result
			else {
				compressed = await result
				if (this.res.closed) return
			}
		}

		this.compressionHeader(data instanceof Readable)

		if (this.responseHeaders['content-length']) { // Make sure content-length is the last header (truly cursed)
			const old = this.responseHeaders['content-length']
			delete this.responseHeaders['content-length']
			this.responseHeaders['content-length'] = old
		}

		if (this.head !== null) {
			this.res.cork()
			this.res.write(`HTTP/1.1 ${this.statusCode} ${this.statusMessage}\r\n`)
			writeRawHeaders(as<Duplex>(this.res), this.responseHeaders)

			if (!compression && data instanceof ArrayBuffer && this.method() !== 'HEAD') this.res.write(`content-length: ${data.byteLength}\r\n`)

			this.res.write('\r\n')
			this.res.uncork()
		} else {
			if (compressed !== null && this.method() !== 'HEAD') this.responseHeaders['content-length'] = compressed.byteLength.toString()

			as<ServerResponse>(this.res).writeHead(this.statusCode, this.statusMessage, this.responseHeaders)
		}

		if (compressed !== null) {
			this.res.end(compressed)
		} else {
			compressionStream(compression, data as Readable, this.res)
		}
	}

	private writeCachedFile(file: string, entry: CachedFile): void {
		const compression = this.getCompression()

		if (compression) {
			const cached = entry[compression]

			if (!cached) {
				const result = compressionSync(compression, entry.data)

				if (Buffer.isBuffer(result)) storeCompressed(file, entry, compression, result)
				else {
					result.then((compressed) => {
						storeCompressed(file, entry, compression, compressed)
						this.endFile(compressed)
					}, () => this.res.destroy())

					return
				}
			}

			return this.endFile(entry[compression] ?? entry.data)
		}

		this.endFile(entry.data)
	}

	private endFile(data: Buffer): void {
		if (this.res.closed) return

		this.compressionHeader(false)

		delete this.responseHeaders['content-length']
		this.responseHeaders['content-length'] = data.byteLength.toString()

		as<ServerResponse>(this.res).writeHead(this.statusCode, this.statusMessage, this.responseHeaders)
		this.res.end(data)
	}

	public writeFile(file: string, start?: number, end?: number, stat?: FileStat): void {
		if (stat && this.fileCache && this.head === null && stat.size <= maxFileSize && !start && (end === undefined || end === stat.size)) {
			const cached = getFile(file, stat)
			if (cached) return this.writeCachedFile(file, cached)

			fs.readFile(file, (err, data) => {
				if (err) {
					this.res.destroy()
					return
				}

				if (data.byteLength !== stat.size) {
					this.compress(null)
					return this.endFile(data)
				}

				this.writeCachedFile(file, storeFile(file, stat, data))
			})

			return
		}

		this.compressionHeader(true)
		if (this.getCompression()) delete this.responseHeaders['content-length']

		if (this.res.closed) return

		if (this.responseHeaders['content-length']) { // Make sure content-length is the last header (truly cursed)
			const old = this.responseHeaders['content-length']
			delete this.responseHeaders['content-length']
			this.responseHeaders['content-length'] = old
		}

		if (this.head !== null) {
			this.res.cork()
			this.res.write(`HTTP/1.1 ${this.statusCode} ${this.statusMessage}\r\n`)
			writeRawHeaders(as<Duplex>(this.res), this.responseHeaders)

			this.res.write('\r\n')
			this.res.uncork()
		} else {
			as<ServerResponse>(this.res).writeHead(this.statusCode, this.statusMessage, this.responseHeaders)
		}

		compressionStream(this.getCompression(), fs.createReadStream(file, { start, end }), this.res)
	}

	public upgrade(data: ImplementationWebsocketData): boolean {
		if (this.req.closed || this.res.closed || this.head === null || this.res instanceof ServerResponse || !this.req.headers['sec-websocket-key']) return false

		const id = number.generate(0, 1000000),
			headerListener = (headers: string[]) => {
				if (as<{ ID: number }>(this.req).ID !== id) return
		
				for (const key in this.responseHeaders) {
					const values = this.responseHeaders[key]

					if (typeof values === 'string') headers.push(`${key}: ${values}`)
					else for (const value of values) {
						headers.push(`${key}: ${value}`)
					}
				}

				this.server.off('headers', headerListener)
			}

		as<{ ID: number }>(this.req).ID = id
		this.server.on('headers', headerListener)

		this.server.handleUpgrade(this.req, this.res, this.head, (ws) => {
			ws.once('close', async() => {
				const context = new WsContext('c', ws, Buffer.allocUnsafe(0).buffer as ArrayBuffer, false, data)

				for (const [ _, websockets ] of subscriberCollection) {
					const index = websockets.indexOf(ws)

					if (index !== -1) {
						websockets.splice(index, 1)
					}
				}

				return Promise.resolve(this.serve.websocket.close(context))
			})

			ws.on('message', async(message, isBinary) => {
				const context = new WsContext('m', ws, Buffer.from(message as any), isBinary, data)

				return Promise.resolve(this.serve.websocket.message(context))
			})

			const context = new WsContext('o', ws, Buffer.allocUnsafe(0).buffer as ArrayBuffer, false, data)
			return Promise.resolve(this.serve.websocket.open(context))
		})

		return true
	}
}