package com.example.lyftwatcher

object CardParser {

    private val MONEY = Regex("""\$\s?(\d+(?:\.\d{1,2})?)""")
    private val MIN = Regex("""(\d+(?:\.\d+)?)\s?(?:min|mins|minutes)""", RegexOption.IGNORE_CASE)
    private val MI = Regex("""(\d+(?:\.\d+)?)\s?(?:mi|miles)\b""", RegexOption.IGNORE_CASE)
    private val PICKUP_LINE = Regex("""(?i)pickup[^\n]*""")
    private val TRIP_LINE = Regex("""(?i)(?:drop[- ]?off|trip|drive)[^\n]*""")

    fun parse(text: String): RideCard? {
        if (text.isBlank()) return null
        val pay = MONEY.find(text)?.groupValues?.get(1)?.toDoubleOrNull()

        val pickupLine = PICKUP_LINE.find(text)?.value
        val tripLine = TRIP_LINE.find(text)?.value

        val pickupMin = pickupLine?.let { MIN.find(it)?.groupValues?.get(1)?.toDoubleOrNull() }
        val pickupMi = pickupLine?.let { MI.find(it)?.groupValues?.get(1)?.toDoubleOrNull() }
        val tripMin = tripLine?.let { MIN.find(it)?.groupValues?.get(1)?.toDoubleOrNull() }
        val tripMi = tripLine?.let { MI.find(it)?.groupValues?.get(1)?.toDoubleOrNull() }

        if (pay == null && pickupMin == null && tripMin == null) return null
        return RideCard(pay, pickupMin, tripMin, pickupMi, tripMi)
    }
}
