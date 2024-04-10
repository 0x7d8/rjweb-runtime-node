import { ImplementationWsContext, ImplementationWebsocketData } from "rjweb-server"
import { WebSocket } from "ws"

export const subscriberCollection = new Map<number, WebSocket[]>()

export class WsContext extends ImplementationWsContext {
	constructor(private _realType: 'o' | 'm' | 'c', private ws: WebSocket, private _message: ArrayBuffer | Buffer | string, private _isBinary: boolean, private _data: ImplementationWebsocketData) {
		super()
	}

	public type(): 'open' | 'message' | 'close' {
		return this._realType === 'o' ? 'open' : this._realType === 'm' ? 'message' : 'close'
	}

	public write(type: 'text' | 'binary', data: ArrayBuffer, compressed: boolean): void {
		this.ws.send(data, { binary: type === 'binary', compress: compressed })
	}

	public close(code?: number | undefined, reason?: string | undefined): void {
		this.ws.close(code, reason)
	}


	public message(): string | ArrayBuffer | Buffer {
		return this._message
	}

	public messageType(): 'text' | 'binary' {
		return typeof this._isBinary ? 'binary' : 'text'
	}


	public subscribe(id: number): void {
		if (!subscriberCollection.has(id)) {
			subscriberCollection.set(id, [])
		}

		subscriberCollection.get(id)!.push(this.ws)
	}

	public unsubscribe(id: number): void {
		if (subscriberCollection.has(id)) {
			const index = subscriberCollection.get(id)!.indexOf(this.ws)

			if (index !== -1) {
				subscriberCollection.get(id)!.splice(index, 1)
			}
		}
	}


	public data(): ImplementationWebsocketData {
		return this._data
	}
}