import { Context } from "effect";
import {
  NO_PROVIDER_STORE_ROOTS,
  type ProviderStoreRootsValue,
} from "../domain/session/storeRoots.js";

/**
 * The providers' session-store roots, resolved once per invocation at the CLI
 * edge (`ProviderStoreRootsLive`). The provider adapters, the record writers'
 * usage and vibe session discovery all read these, so they read the same
 * stores. The default holds no root: a store read then finds nothing, and vibe
 * usage is unavailable.
 */
export class ProviderStoreRoots extends Context.Reference<ProviderStoreRoots>()(
  "phax/ProviderStoreRoots",
  { defaultValue: (): ProviderStoreRootsValue => NO_PROVIDER_STORE_ROOTS },
) {}
