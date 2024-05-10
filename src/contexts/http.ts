import { ImplementationHttpContext, Method, ValueCollection, ImplementationWebsocketData } from "rjweb-server"
import { WebSocketServer } from "ws"
import { Duplex, Readable } from "stream"
import { IncomingMessage, ServerResponse } from "http"
import * as fs from "fs"
import { WsContext, subscriberCollection } from "@/contexts/ws"
import { as } from "@rjweb/utils"
import { compressionStream, compressionSync } from "@/functions/compression"

export type Serve = {
	http: (context: HttpContext) => Promise<void>,
	websocket: {
		message: (context: WsContext) => Promise<void>,
		open: (context: WsContext) => Promise<void>,
		close: (context: WsContext) => Promise<void>
	}
}

export class HttpContext extends ImplementationHttpContext {
	private abortController = new AbortController()
	private statusCode = 200
	private statusMessage = 'OK'
	private responseHeaders: Record<string, string[]> = {}

	constructor(private req: IncomingMessage, private res: (ServerResponse<IncomingMessage> & { req: IncomingMessage }) | Duplex, private server: WebSocketServer, private serve: Serve, private head: Buffer | null) {
		super()

		req.socket.once('close', () => this.abortController.abort())
	}

	public aborted(): AbortSignal {
		return this.abortController.signal
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
		return new ValueCollection(this.req.headers as any)
	}

	public status(code: number, message: string): this {
		this.statusCode = code
		this.statusMessage = message

		return this
	}

	public header(key: string, value: string): this {
		this.responseHeaders[key] = [ ...this.responseHeaders[key] ?? [], value ]

		return this
	}

	public async write(data: ArrayBuffer | Readable): Promise<void> {
		const compressed = data instanceof ArrayBuffer ? await compressionSync(this.getCompression(), data) : null

		this.res.cork()
		this.compressionHeader(data instanceof Readable)

		if (this.responseHeaders['content-length']) {
			const old = this.responseHeaders['content-length']
			delete this.responseHeaders['content-length']
			this.responseHeaders['content-length'] = old
		}

		if (this.res instanceof Duplex) {
			this.res.write(`HTTP/1.1 ${this.statusCode} ${this.statusMessage}\r\n`)
			for (const [ key, values ] of Object.entries(this.responseHeaders)) {
				for (const value of values) {
					this.res.write(`${key}: ${value}\r\n`)
				}
			}

			if (!this.getCompression() && data instanceof ArrayBuffer && this.method() !== 'HEAD') this.res.write(`content-length: ${data.byteLength}\r\n\r\n`)

			this.res.write('\r\n')
		} else {
			if (compressed instanceof Buffer && this.method() !== 'HEAD') this.responseHeaders['content-length'] = [ compressed.byteLength.toString() ]

			this.res.writeHead(this.statusCode, this.statusMessage, this.responseHeaders)
		}

		this.res.uncork()
		this.req.socket.removeAllListeners('close')

		if (compressed instanceof Buffer) {
			this.res.end(compressed)
		} else {
			compressionStream(this.getCompression(), data as Readable, this.res)
		}
	}

	public writeFile(file: string, start?: number, end?: number): void {
		this.compressionHeader(true)
		if (this.getCompression()) delete this.responseHeaders['content-length']

		if (this.responseHeaders['content-length']) {
			const old = this.responseHeaders['content-length']
			delete this.responseHeaders['content-length']
			this.responseHeaders['content-length'] = old
		}

		if (this.res instanceof Duplex) {
			this.res.cork()
			this.res.write(`HTTP/1.1 ${this.statusCode} ${this.statusMessage}\r\n`)
			for (const [ key, values ] of Object.entries(this.responseHeaders)) {
				for (const value of values) {
					this.res.write(`${key}: ${value}\r\n`)
				}
			}

			this.res.write('\r\n')
			this.res.uncork()
		} else {
			this.res.writeHead(this.statusCode, this.statusMessage, this.responseHeaders)
		}

		this.req.socket.removeAllListeners('close')
		compressionStream(this.getCompression(), fs.createReadStream(file, { start, end }), this.res)
	}

	public upgrade(data: ImplementationWebsocketData): boolean {
		if (this.head === null || this.res instanceof ServerResponse || !this.req.headers['sec-websocket-key']) return false

		const id = Math.floor(Math.random() * 1000000),
			headerListener = (headers: string[]) => {
				if (as<{ ID: number }>(this.req).ID !== id) return
		
				for (const [ key, values ] of Object.entries(this.responseHeaders)) {
					for (const value of values) {
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