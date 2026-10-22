// Bun 1.4.2/1.4.3 keep trusting emSign ECC Root CA - G3 from the runtime's
// own bundle. --use-system-ca and NODE_USE_SYSTEM_CA=1 add the OS store on
// top of that bundle; they do not drop the bundled root. fetch(..., { tls:
// { ca } }) and tls.setDefaultCACertificates replace the store, so outbound
// HTTPS from these processes uses only the OS certificates.
const tls = require("node:tls");
const { X509Certificate } = require("node:crypto");

const system = tls.getCACertificates("system");
let g3 = 0;
let aaa = 0;
for (const pem of system) {
	const subject = new X509Certificate(pem).subject;
	if (subject.includes("emSign ECC Root CA - G3")) g3 += 1;
	if (subject.includes("AAA Certificate Services")) aaa += 1;
}
if (g3 !== 0 || aaa !== 0 || system.length === 0) {
	throw new Error(`bun-system-ca: refusing to start (n=${system.length} g3=${g3} aaa=${aaa})`);
}

tls.setDefaultCACertificates(system);

const baseFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
	const next = { ...(init ?? {}) };
	const tlsOptions = next.tls ?? {};
	if (tlsOptions.ca == null) next.tls = { ...tlsOptions, ca: system };
	return baseFetch(input, next);
};
