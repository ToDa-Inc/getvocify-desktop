import Foundation

/// Endings of a live phrase, longest first, for a one-line label that must never
/// clip a word: the whole text, then each later sentence, then whole-word tails.
public enum PhraseFit {
    public static func candidates(_ text: String) -> [String] {
        let clean = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !clean.isEmpty else { return [] }
        let body = clean.hasPrefix("…") ? String(clean.dropFirst()) : clean
        var result = [clean]

        let chars = Array(body)
        var index = 0
        while index < chars.count - 1 {
            if ".!?…".contains(chars[index]), chars[index + 1] == " ", index + 2 < chars.count {
                result.append(String(chars[(index + 2)...]))
            }
            index += 1
        }

        var words = body.split(separator: " ").map(String.init)
        while words.count > 1 {
            words.removeFirst()
            result.append("…" + words.joined(separator: " "))
        }

        var seen = Set<String>()
        return result.filter { seen.insert($0).inserted }
    }
}
