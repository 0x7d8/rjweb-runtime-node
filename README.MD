# `@rjweb/runtime-node`

<img style="float: right;" alt="RJWEB Icon" height="104" src="https://cdn.rjns.dev/rjweb/icon.svg">

Node Runtime using `http` library for [`rjweb-server`](https://npmjs.com/rjweb-server).

🏠 [Homepage](https://github.com/0x7d8/NPM_WEB-SERVER#readme)
🔍 [Documentation](https://server.rjweb.dev)

## Disclaimer

This Package is intended to be used in the backend. DO NOT USE THIS PACKAGE WITH BUN.

- ✔️ ESM
- ✔️ CJS
- ✔️ Typescript

## Install

```sh
npm install @rjweb/runtime-node
yarn add @rjweb/runtime-node
pnpm add @rjweb/runtime-node
bun install @rjweb/runtime-node # not recommended to run the code, installing is fine
```

## Example Usage

### Basic Server

```ts
import { Server } from "rjweb-server"
import { Runtime } from "@rjweb/runtime-node"

const server = new Server(Runtime, {
  port: 8080 // https://server.rjweb.dev/types/ServerOptions
})

server.path('/', (path) => path
  .http('GET', '/', (http) => http
    .onRequest((ctr) => {
      return ctr.print('Hello World!')
    })
  )
)

server.start().then((port) => {
  console.log(`Server started on port ${port}!`)
})
```

[view more](https://npmjs.com/rjweb-server)

## Author

👤 **0x7d8**
🌐 [Website](https://rjansen.dev)
⭐ [GitHub](https://github.com/0x7d8)

## 🤝 Contributing

Contributions, issues and feature requests are welcome!
Feel free to check [issues page](https://github.com/0x7d8/rjweb-runtime-node/issues).

## Show your support

Give a ⭐️ if this project helps you!

## 📝 License

Copyright © 2024 [0x7d8](https://github.com/0x7d8).
This project is MIT licensed.
