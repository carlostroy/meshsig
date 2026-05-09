import Foundation

enum Verdict: String, Codable {
    case accept
    case maybe
    case reject

    var label: String {
        switch self {
        case .accept: return "PEGA"
        case .maybe: return "TALVEZ"
        case .reject: return "RECUSA"
        }
    }

    var emoji: String {
        switch self {
        case .accept: return "✅"
        case .maybe: return "⚠️"
        case .reject: return "❌"
        }
    }
}

struct RuleSet: Codable, Equatable {
    var minPay: Double = 6.0
    var minPerHour: Double = 25.0
    var minPerMileTrip: Double = 1.0
    var maxPickupRatio: Double = 0.30
    var maxPickupMin: Double = 12.0

    var minPerHourMaybe: Double = 20.0
    var maxPickupRatioMaybe: Double = 0.40

    static let `default` = RuleSet()
}

struct Decision: Equatable {
    let verdict: Verdict
    let reasons: [String]
    let summary: String
    let card: RideCard

    var headline: String {
        return "\(verdict.emoji) \(verdict.label)"
    }
}

enum RulesEngine {

    static func evaluate(card: RideCard, rules: RuleSet) -> Decision {
        var rejectReasons: [String] = []
        var warnReasons: [String] = []

        if let pay = card.pay {
            if pay < rules.minPay {
                rejectReasons.append(String(format: "pay $%.2f abaixo do mínimo $%.2f", pay, rules.minPay))
            }
        }

        if let ph = card.computedPerHour() {
            if ph < rules.minPerHourMaybe {
                rejectReasons.append(String(format: "$%.0f/hr muito baixo", ph))
            } else if ph < rules.minPerHour {
                warnReasons.append(String(format: "$%.0f/hr abaixo do alvo $%.0f", ph, rules.minPerHour))
            }
        }

        if let pickup = card.pickupMin, pickup > rules.maxPickupMin {
            rejectReasons.append(String(format: "pickup %.0f min muito longe", pickup))
        }

        if let ratio = card.pickupRatio() {
            if ratio > rules.maxPickupRatioMaybe {
                rejectReasons.append(String(format: "pickup %d%% do tempo", Int(ratio * 100)))
            } else if ratio > rules.maxPickupRatio {
                warnReasons.append(String(format: "pickup %d%% (alvo %d%%)", Int(ratio * 100), Int(rules.maxPickupRatio * 100)))
            }
        }

        if let pmi = card.perMileTrip(), pmi < rules.minPerMileTrip {
            warnReasons.append(String(format: "$%.2f/mi baixo", pmi))
        }

        let summary = makeSummary(card: card)

        if !rejectReasons.isEmpty {
            return Decision(verdict: .reject, reasons: rejectReasons, summary: summary, card: card)
        }
        if !warnReasons.isEmpty {
            return Decision(verdict: .maybe, reasons: warnReasons, summary: summary, card: card)
        }
        return Decision(verdict: .accept, reasons: ["dentro de todos os critérios"], summary: summary, card: card)
    }

    private static func makeSummary(card: RideCard) -> String {
        var parts: [String] = []
        if let pay = card.pay { parts.append(String(format: "$%.2f", pay)) }
        if let ph = card.computedPerHour() { parts.append(String(format: "$%.0f/hr", ph)) }
        if let pickupMin = card.pickupMin, let pickupMi = card.pickupMi {
            parts.append(String(format: "pickup %.0fmin/%.1fmi", pickupMin, pickupMi))
        }
        if let tripMin = card.tripMin, let tripMi = card.tripMi {
            parts.append(String(format: "trip %.0fmin/%.1fmi", tripMin, tripMi))
        }
        return parts.joined(separator: " · ")
    }
}
