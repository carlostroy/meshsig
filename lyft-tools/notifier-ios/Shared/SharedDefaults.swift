import Foundation

enum SharedDefaults {
    static let appGroup = "group.com.lyftadvisor.shared"

    private static var defaults: UserDefaults {
        return UserDefaults(suiteName: appGroup) ?? .standard
    }

    private static let rulesKey = "rules.v1"
    private static let lastDecisionKey = "lastDecision.v1"
    private static let lastFireKey = "lastFire.v1"

    static func loadRules() -> RuleSet {
        guard let data = defaults.data(forKey: rulesKey),
              let rules = try? JSONDecoder().decode(RuleSet.self, from: data) else {
            return .default
        }
        return rules
    }

    static func saveRules(_ rules: RuleSet) {
        if let data = try? JSONEncoder().encode(rules) {
            defaults.set(data, forKey: rulesKey)
        }
    }

    static func saveLastDecision(verdict: String, summary: String, reasons: [String]) {
        let payload: [String: Any] = [
            "verdict": verdict,
            "summary": summary,
            "reasons": reasons,
            "timestamp": Date().timeIntervalSince1970
        ]
        defaults.set(payload, forKey: lastDecisionKey)
    }

    static func loadLastDecision() -> [String: Any]? {
        return defaults.dictionary(forKey: lastDecisionKey)
    }

    static func shouldFire(cooldown: TimeInterval = 3.0) -> Bool {
        let last = defaults.double(forKey: lastFireKey)
        let now = Date().timeIntervalSince1970
        if now - last < cooldown { return false }
        defaults.set(now, forKey: lastFireKey)
        return true
    }
}
