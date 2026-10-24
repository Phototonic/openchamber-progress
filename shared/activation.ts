import { canonical, digest } from './store.ts';
import type { Binding } from './binding.ts';

/** Match loaded bytes AND their binding/version, not merely a semver label. */
export function activationFingerprint(binding:Binding,plugin:Uint8Array,guidance:Uint8Array) {
  return digest(canonical({binding,plugin:digest(plugin),guidance:digest(guidance)}));
}
