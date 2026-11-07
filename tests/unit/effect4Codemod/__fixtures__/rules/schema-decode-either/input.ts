import { ParseResult, Schema } from "effect";

const Endpoint = Schema.Struct({ host: Schema.String, port: Schema.Number });
type Endpoint = typeof Endpoint.Type;

export const decodeEndpoint = Schema.decodeEither(Endpoint);

export const decodeEndpointInput = (input: unknown) => Schema.decodeUnknownEither(Endpoint)(input);

export const encodeEndpoint = (endpoint: Endpoint) => Schema.encodeEither(Endpoint)(endpoint);

export const encodeEndpointInput = Schema.encodeUnknownEither(Endpoint);

export const parseEndpoint = (input: unknown) => ParseResult.decodeUnknownEither(Endpoint)(input);
