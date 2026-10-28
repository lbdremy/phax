import { Context } from "effect";
import {
  NO_PROVIDER_STORE_ROOTS,
  type ProviderStoreRootsValue,
} from "../domain/session/storeRoots.js";

/**
 * The providers' session-store roots, resolved once per invocation at the CLI
 * edge (`ProviderStoreRootsLive`). The Claude Code and codex adapters read
 * these, so a transcript capture and the record writers read the same stores.
 * Vibe has no root: phax never reads its home directory. The default holds no
 * root: a store read then finds nothing.
 */
export class ProviderStoreRoots extends Context.Reference<ProviderStoreRoots>()(
  "phax/ProviderStoreRoots",
  { defaultValue: (): ProviderStoreRootsValue => NO_PROVIDER_STORE_ROOTS },
) {}
