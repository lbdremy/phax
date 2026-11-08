import { Schema } from "effect";

const Endpoint = Schema.Struct({ host: Schema.String, port: Schema.Number });
type Endpoint = typeof Endpoint.Type;

export const decodeEndpoint = Schema.decodeUnknownResult(Endpoint);

export const decodeEndpointInput = (input: unknown) => Schema.decodeUnknownResult(Endpoint)(input);

export const encodeEndpoint = (endpoint: Endpoint) => Schema.encodeUnknownResult(Endpoint)(endpoint);

export const encodeEndpointInput = Schema.encodeUnknownResult(Endpoint);

export const parseEndpoint = (input: unknown) => Schema.decodeUnknownResult(Endpoint)(input);
