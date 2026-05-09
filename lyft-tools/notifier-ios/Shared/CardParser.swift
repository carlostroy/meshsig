import Foundation

enum CardParser {

    private static func parseNumber(_ s: String) -> Double? {
        let normalized = s.replacingOccurrences(of: ",", with: ".")
        return Double(normalized)
    }

    private static func firstMatch(_ pattern: String, in text: String, options: NSRegularExpression.Options = [.caseInsensitive]) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, options: [], range: range) else { return nil }
        var groups: [String] = []
        for i in 0..<match.numberOfRanges {
            if let r = Range(match.range(at: i), in: text) {
                groups.append(String(text[r]))
            } else {
                groups.append("")
            }
        }
        return groups
    }

    private static func allMatches(_ pattern: String, in text: String, options: NSRegularExpression.Options = [.caseInsensitive]) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        let matches = regex.matches(in: text, options: [], range: range)
        return matches.map { match in
            (0..<match.numberOfRanges).map { i -> String in
                if let r = Range(match.range(at: i), in: text) {
                    return String(text[r])
                }
                return ""
            }
        }
    }

    static func parse(text: String) -> RideCard? {
        guard !text.isEmpty else { return nil }

        var card = RideCard()

        // Pay: "US$ 28,01" or "$ 5,32" or "US$ 28.01"
        if let g = firstMatch(#"US\$\s*(\d+[.,]\d{2})"#, in: text) ?? firstMatch(#"\$\s*(\d+[.,]\d{2})"#, in: text) {
            card.pay = parseNumber(g[1])
        }

        // Hourly rate (Lyft already calculates it):
        // "Taxa de US$ 31,12/hora" or "Taxa de $24,55/hora"
        if let g = firstMatch(#"(?:Taxa de\s*)?US\$\s*(\d+[.,]\d{2})\s*/\s*hora"#, in: text) {
            card.perHourLyft = parseNumber(g[1])
        }

        // Bonus: "Incl. $1.52 em bônus" or "Incl. bônus de $4.88"
        if let g = firstMatch(#"\$\s*(\d+[.,]\d{2})\s*em\s*b[oô]nus"#, in: text) ?? firstMatch(#"b[oô]nus\s*de\s*\$?\s*(\d+[.,]\d{2})"#, in: text) {
            card.bonus = parseNumber(g[1])
        }

        // Time/distance pairs: "9 min · 3,2 mi" — first occurrence is pickup, second is trip
        let pairs = allMatches(#"(\d+)\s*min\s*[·•:.\-]\s*(\d+[.,]?\d*)\s*mi"#, in: text)

        if pairs.count >= 1 {
            card.pickupMin = parseNumber(pairs[0][1])
            card.pickupMi = parseNumber(pairs[0][2])
        }
        if pairs.count >= 2 {
            card.tripMin = parseNumber(pairs[1][1])
            card.tripMi = parseNumber(pairs[1][2])
        }

        return card.hasMinimumData ? card : nil
    }
}
