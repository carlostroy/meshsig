import Foundation

struct RideCard: Equatable, Codable {
    var pay: Double?
    var perHourLyft: Double?
    var pickupMin: Double?
    var pickupMi: Double?
    var tripMin: Double?
    var tripMi: Double?
    var bonus: Double?

    func computedPerHour() -> Double? {
        if let lyft = perHourLyft { return lyft }
        let pickup = pickupMin ?? 0
        let trip = tripMin ?? 0
        let total = pickup + trip
        guard let pay = pay, total > 0 else { return nil }
        return pay / total * 60.0
    }

    func perMileTrip() -> Double? {
        guard let pay = pay, let trip = tripMi, trip > 0 else { return nil }
        return pay / trip
    }

    func perMileTotal() -> Double? {
        guard let pay = pay else { return nil }
        let total = (pickupMi ?? 0) + (tripMi ?? 0)
        guard total > 0 else { return nil }
        return pay / total
    }

    func totalMin() -> Double? {
        let total = (pickupMin ?? 0) + (tripMin ?? 0)
        return total > 0 ? total : nil
    }

    func pickupRatio() -> Double? {
        guard let p = pickupMin, let t = totalMin(), t > 0 else { return nil }
        return p / t
    }

    var hasMinimumData: Bool {
        return pay != nil && (perHourLyft != nil || (pickupMin != nil && tripMin != nil))
    }
}
