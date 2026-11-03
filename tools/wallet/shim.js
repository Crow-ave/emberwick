import { Buffer } from 'buffer';
export { Buffer };
if (typeof window !== 'undefined') { window.Buffer = window.Buffer || Buffer; window.global = window.global || window; window.process = window.process || { env: {} }; }
