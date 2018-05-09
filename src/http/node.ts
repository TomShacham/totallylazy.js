import {Body, Chunk, Handler, Header, Headers, host, isBody, Request, request, Response, Server, Uri} from ".";
import {createServer, IncomingMessage, request as NodeRequest, Server as NodeServer, ServerResponse} from 'http';
import {TextEncoder} from 'text-encoding';
import {URL} from 'url';

export class ClientHandler implements Handler {
    handle(request: Request): Promise<Response> {
        return new Promise<Response>(resolve => {
                let [hostname, port = 80] = host(request).split(':');
                let nodeRequest = NodeRequest({
                    method: request.method,
                    path: request.uri.path,
                    hostname: hostname,
                    port: port,
                    headers: request.headers
                }, (nodeResponse: IncomingMessage) => {
                    resolve({
                        status: nodeResponse.statusCode || -1,
                        headers: nodeResponse.headers as Headers,
                        body: new MessageBody(nodeResponse)
                    });
                });
                if (request.body) {
                    request.body.text().then(value => {
                        nodeRequest.write(value);
                        nodeRequest.end();
                    });
                } else {
                    nodeRequest.end();
                }
            }
        );
    }
}

export const adapter = (handler:Handler) => (nodeRequest: IncomingMessage, nodeResponse: ServerResponse) => {
    let req = request(nodeRequest.method || "",
        nodeRequest.url || "",
        nodeRequest.headers as Headers,
        new MessageBody(nodeRequest));

    (async () => {
        const response = await handler.handle(req);
        nodeResponse.statusCode = response.status;
        for (let h in response.headers) {
            const name = h as Header;
            const value = response.headers[name];
            if (value) nodeResponse.setHeader(name, value);
        }
        if (isBody(response.body)) {
            try {
                const text = await response.body.text();
                nodeResponse.write(text);
            } catch (e) {
                for await(const value of response.body) {
                    nodeResponse.write(Buffer.from(value.data().buffer as any));
                }
            } finally {
                nodeResponse.end();
            }
        } else {
            nodeResponse.end();
        }
    })();
};

export class ServerHandler implements Server {
    private server: NodeServer;
    private uri: Promise<Uri>;

    constructor(private handler: Handler, {port = 0} = {}) {
        const server = createServer(adapter(this));
        this.server = server;
        this.server.listen(port);
        this.uri = new Promise<Uri>((resolve) => {
            server.on('listening', () => {
                resolve(new Uri(`http://localhost:${server.address().port}/`))
            })
        })
    }

    handle(request: Request): Promise<Response> {
        return this.handler.handle(request);
    }

    close(): Promise<void> {
        return new Promise<void>(resolve => {
            this.server.close(function () {
                resolve();
            });
        });
    }

    url(): Promise<Uri> {
        return this.uri;
    }
}


export class MessageBody implements Body {
    constructor(private message: IncomingMessage) {
    }

    text(): Promise<string> {
        const buffer: string[] = [];

        this.message.on("data", chunk => {
            buffer.push(chunk.toString());
        });

        return new Promise<string>((resolve, reject) => {
            this.message.on("end", () => {
                resolve(buffer.join("").toString())
            });
            this.message.on("error", error => {
                reject(error);
            });
        });
    }

    [Symbol.asyncIterator](): AsyncIterator<Chunk> {
        const iterator = new AsyncIteratorHandler<Chunk>();
        this.message.on("data", chunk => {
            iterator.handle({value: typeof chunk == 'string' ? stringChunk(chunk) : bufferChunk(chunk), done: false});
        });
        this.message.on("end", () => {
            iterator.handle({value: null as any, done: true})
        });
        this.message.on("error", error => {
            iterator.handle(error)
        });
        return iterator;
    }
}

function stringChunk(value: string): Chunk {
    return {
        text: () => value,
        data: () => new TextEncoder().encode(value),
    }
}

function bufferChunk(value: Buffer): Chunk {
    return {
        text: () => value.toString(),
        data: () => value,
    }
}

type StateHandler = [Function, Function];
type IteratorState<T> = StateHandler | IteratorResult<T> | Error;

function isStateHandler<T>(state: IteratorState<T>): state is StateHandler {
    return Array.isArray(state);
}

function consume<T>(state: IteratorResult<T> | Error, [resolve, reject]: [Function, Function]) {
    if (state instanceof Error) reject(state);
    else resolve(state);
}

class AsyncIteratorHandler<T> implements AsyncIterator<T> {
    private state: IteratorState<T>[] = [];

    handle(newState: IteratorState<T>) {
        const nextState = this.state.pop();
        if (typeof nextState == 'undefined') return this.state.push(newState);
        if (isStateHandler(newState) && !isStateHandler(nextState)) return consume(nextState, newState);
        if (!isStateHandler(newState) && isStateHandler(nextState)) return consume(newState, nextState);
        this.state.unshift(nextState);
        this.state.push(newState);
    }

    next(): Promise<IteratorResult<T>> {
        return new Promise<IteratorResult<T>>((resolve, reject) => {
            this.handle([resolve, reject]);
        });
    }
}

