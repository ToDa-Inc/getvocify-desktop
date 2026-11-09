// electron-builder's `mac.sign` for builds signed with the team's self-signed "Vocify Dev" certificate
// (`npm run dist:mac:self-signed`). electron-builder only picks identities macOS trusts, and a CI runner cannot be
// told to trust a self-signed certificate; codesign itself signs with it by its SHA-1 as long as its keychain is on
// the search list (scripts/import-apple-cert.sh puts it there). So this hands electron-builder's own signing that
// SHA-1 instead of letting it look the identity up.
const { sign } = require("app-builder-lib/out/codeSign/macCodeSign");

const VOCIFY_DEV_SHA1 = "70D4242A077672091CF69A7C118A8671C0995D8F";

exports.default = async function signWithVocifyDev(opts) {
  await sign({ ...opts, identity: VOCIFY_DEV_SHA1, identityValidation: false });
};
