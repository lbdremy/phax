import { Schema } from "effect";

const Endpoint = Schema.Struct({ host: Schema.String, port: Schema.Number });
type Endpoint = typeof Endpoint.Type;

export const decodeEndpoint = Schema.decodeExit(Endpoint);

export const decodeEndpointInput = (input: unknown) => Schema.decodeUnknownExit(Endpoint)(input);

export const encodeEndpoint = (endpoint: Endpoint) => Schema.encodeExit(Endpoint)(endpoint);

export const encodeEndpointInput = Schema.encodeUnknownExit(Endpoint);

export const parseEndpoint = (input: unknown) => Schema.decodeUnknownExit(Endpoint)(input);
