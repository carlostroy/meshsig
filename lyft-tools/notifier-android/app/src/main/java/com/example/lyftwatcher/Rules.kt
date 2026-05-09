package com.example.lyftwatcher

import org.json.JSONArray
import org.json.JSONObject

data class RideCard(
    val pay: Double?,
    val pickupMin: Double?,
    val tripMin: Double?,
    val pickupMi: Double?,
    val tripMi: Double?
) {
    fun perHour(): Double? {
        val total = (pickupMin ?: 0.0) + (tripMin ?: 0.0)
        if (pay == null || total <= 0.0) return null
        return pay / total * 60.0
    }
    fun perMile(): Double? {
        if (pay == null || tripMi == null || tripMi <= 0.0) return null
        return pay / tripMi
    }
}

data class Rule(
    val minPay: Double? = null,
    val maxPay: Double? = null,
    val minPerHour: Double? = null,
    val minPerMile: Double? = null,
    val maxPickupMin: Double? = null,
    val maxPickupMi: Double? = null,
    val sound: String
) {
    fun matches(c: RideCard): Boolean {
        minPay?.let { if (c.pay == null || c.pay < it) return false }
        maxPay?.let { if (c.pay == null || c.pay > it) return false }
        minPerHour?.let { val ph = c.perHour() ?: return false; if (ph < it) return false }
        minPerMile?.let { val pm = c.perMile() ?: return false; if (pm < it) return false }
        maxPickupMin?.let { if (c.pickupMin == null || c.pickupMin > it) return false }
        maxPickupMi?.let { if (c.pickupMi == null || c.pickupMi > it) return false }
        return true
    }
}

object Rules {
    const val DEFAULT_JSON = """[
  { "minPay": 8.00, "maxPickupMin": 5, "sound": "loud_chime" },
  { "minPay": 5.00, "sound": "soft_ping" },
  { "sound": "silent" }
]"""

    fun parse(json: String): List<Rule> {
        val arr = JSONArray(json)
        val out = mutableListOf<Rule>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            out.add(
                Rule(
                    minPay = o.optDoubleOrNull("minPay"),
                    maxPay = o.optDoubleOrNull("maxPay"),
                    minPerHour = o.optDoubleOrNull("minPerHour"),
                    minPerMile = o.optDoubleOrNull("minPerMile"),
                    maxPickupMin = o.optDoubleOrNull("maxPickupMin"),
                    maxPickupMi = o.optDoubleOrNull("maxPickupMi"),
                    sound = o.optString("sound", "silent")
                )
            )
        }
        return out
    }

    fun firstMatch(rules: List<Rule>, card: RideCard): Rule? =
        rules.firstOrNull { it.matches(card) }
}

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (has(key) && !isNull(key)) optDouble(key) else null
