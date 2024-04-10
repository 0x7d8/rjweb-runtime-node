import { version as packageVersion } from "package.json"
export const version: string = packageVersion

import { Implementation, ImplementationHandleRecord } from "rjweb-server"
import { HttpContext, Serve } from "@/contexts/http"
import { subscriberCollection } from "@/contexts/ws"
import { Server } from "http"
import { WebSocketServer } from "ws"

export class Runtime extends Implementation {
	private server: WebSocketServer | null = null
	private serverHttp: Server | null = null
	private interval: NodeJS.Timeout | null = null
	private serve: Serve = {
		http: () => Promise.resolve(),
		websocket: {
			message: () => Promise.resolve(),
			open: () => Promise.resolve(),
			close: () => Promise.resolve()
		}
	}

	public name(): string {
		return '@rjweb/runtime-node'
	}

	public version(): string {
		return version
	}

	public port(): number {
		return this.options.port
	}

	public start(): Promise<void> {
		return new Promise((resolve) => {
			const server = new Server()

			server.on('request', (req, res) => {
				const context = new HttpContext(req, res, this.server!, this.serve, null)

				return Promise.resolve(this.serve.http(context))
			})

			server.on('upgrade', (req, socket, head) => {
				const context = new HttpContext(req, socket, this.server!, this.serve, head)

				return Promise.resolve(this.serve.http(context))
			})

			this.server = new WebSocketServer({
				noServer: true
			})

			this.interval = setInterval(() => {
				for (const ws of this.server?.clients ?? []) {
					if (ws.isPaused || ws.readyState !== ws.OPEN) continue

					ws.ping()
				}
			}, 30000)

			this.serverHttp = server
			server.listen(this.options.port, this.options.bind, () => resolve())
		})
	}

	public stop(): void {
		this.serverHttp?.close()
		this.server = null
		this.serverHttp = null
		if (this.interval) clearInterval(this.interval)
	}

	public handle(handlers: { [key in keyof ImplementationHandleRecord]: (context: ImplementationHandleRecord[key]) => Promise<any> }): void {
		this.serve.http = handlers.http
		this.serve.websocket.message = handlers.ws
		this.serve.websocket.open = handlers.ws
		this.serve.websocket.close = handlers.ws
	}

	public wsPublish(type: 'text' | 'binary', id: number, data: ArrayBuffer, compressed: boolean): void {
		for (const ws of subscriberCollection.get(id) ?? []) {
			if (ws.isPaused || ws.readyState !== ws.OPEN) continue

			ws.send(data, { binary: type === 'binary', compress: compressed })
		}
	}
}