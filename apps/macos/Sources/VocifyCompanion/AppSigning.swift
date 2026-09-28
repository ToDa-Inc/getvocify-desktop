import Foundation
import Security

/// macOS TCC (Screen & System Audio) keys permissions to a stable code signature.
/// Ad-hoc builds (`codesign -s -`) get a new hash every compile, so the app never
/// appears in Settings and grants cannot stick. See Apple TN3127.
enum AppSigning {
    struct Info {
        let isAdHoc: Bool
        let teamID: String?
        let authority: String?
    }

    static func info() -> Info {
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(Bundle.main.bundleURL as CFURL, [], &staticCode) == errSecSuccess,
              let code = staticCode
        else {
            return Info(isAdHoc: true, teamID: nil, authority: nil)
        }
        var raw: CFDictionary?
        guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &raw) == errSecSuccess,
              let dict = raw as? [String: Any]
        else {
            return Info(isAdHoc: true, teamID: nil, authority: nil)
        }
        let team = dict[kSecCodeInfoTeamIdentifier as String] as? String
        let flags = dict[kSecCodeInfoFlags as String] as? UInt32 ?? 0
        // kSecCodeSignatureAdhoc — stable check; self-signed dev certs have no team but are not ad-hoc.
        let isAdHoc = (flags & 0x0002) != 0
        let certs = dict[kSecCodeInfoCertificates as String] as? [SecCertificate]
        let authority: String?
        if let cert = certs?.first {
            var commonName: CFString?
            SecCertificateCopyCommonName(cert, &commonName)
            authority = commonName as String?
        } else {
            authority = nil
        }
        return Info(isAdHoc: isAdHoc, teamID: team, authority: authority)
    }
}
