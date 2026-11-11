import { createRequire } from "node:module";
import net, { type AddressInfo } from "node:net";

import { neonConfig } from "@neondatabase/serverless";
import { WebSocket, WebSocketServer } from "ws";

/**
 * Lets the real Neon driver reach the throwaway Postgres. Neon's driver
 * speaks Postgres over a WebSocket that Neon's own proxy relays to the
 * database; this does the same relaying on this machine, so a test runs the
 * driver the live site runs, not node-postgres.
 */

/** Any host but localhost: `createDb` gives localhost node-postgres instead of Neon's driver. */
const BRIDGED_HOST = "neon-bridge.test";
const DATABASE_HOST = "127.0.0.1";

/** Neon's driver as a second copy (its CommonJS build), as a separately bundled hook loads it. */
export type NeonDriverCopy = typeof import("@neondatabase/serverless");

export interface NeonBridge {
  /** The same database as `connectionString`, reached through the bridge. */
  bridged: (connectionString: string) => string;
  /** A second copy of the driver, set up to use the bridge too. */
  secondDriverCopy: NeonDriverCopy;
  close: () => Promise<void>;
}

function relay(socket: WebSocket, port: number): void {
  const database = net.connect(port, DATABASE_HOST);
  const waiting: Buffer[] = [];
  let isConnected = false;
  database.on("connect", () => {
    isConnected = true;
    waiting.forEach((chunk) => database.write(chunk));
  });
  socket.on("message", (data: Buffer) => {
    if (isConnected) {
      database.write(data);
    } else {
      waiting.push(data);
    }
  });
  database.on("data", (data) => socket.send(data));
  database.on("close", () => socket.close());
  database.on("error", () => socket.close());
  socket.on("close", () => database.destroy());
}

function useBridge(config: typeof neonConfig, bridgePort: number): void {
  Object.assign(config, {
    webSocketConstructor: WebSocket,
    useSecureWebSocket: false,
    pipelineConnect: false,
    pipelineTLS: false,
    wsProxy: (_host: string, port: number) => `127.0.0.1:${bridgePort}/v1?port=${port}`,
  });
}

/** Starts the relay and points both copies of Neon's driver at it. */
export async function startNeonBridge(): Promise<NeonBridge> {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket, request) => {
    const port = Number(new URL(request.url ?? "", "http://bridge").searchParams.get("port"));
    relay(socket, port);
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const bridgePort = (server.address() as AddressInfo).port;

  const secondDriverCopy = createRequire(import.meta.url)(
    "@neondatabase/serverless",
  ) as NeonDriverCopy;
  useBridge(neonConfig, bridgePort);
  useBridge(secondDriverCopy.neonConfig, bridgePort);

  return {
    bridged: (connectionString) => {
      const url = new URL(connectionString);
      url.hostname = BRIDGED_HOST;
      return url.toString();
    },
    secondDriverCopy,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
