import { connectHost } from '@openchamber/sdk';
import { registerSessionActions } from './session-actions.ts';

const host = connectHost();
const retire = registerSessionActions(host);
window.addEventListener('pagehide', () => { retire(); host.dispose(); }, { once: true });
