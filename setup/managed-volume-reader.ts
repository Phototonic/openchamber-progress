import type {ManagedVolumeIdentityReader} from './managed-volume-identity.ts';

// Production join: re-export readLinuxManagedVolumeIdentity under this name.
export const managedVolumeIdentityReader:ManagedVolumeIdentityReader=()=>({kind:'unavailable'});
