package com.example.lyftwatcher

import android.accessibilityservice.AccessibilityService
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.io.File

class LyftWatcherService : AccessibilityService() {

    private val tag = "LyftWatcher"
    private var lastFireAt = 0L
    private val cooldownMs = 4000L
    private var lastCardSig: String? = null

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        if (event.packageName?.toString() != "com.lyft.android.driver") return

        val root = rootInActiveWindow ?: return
        val text = collectText(root, StringBuilder()).toString()
        val card = CardParser.parse(text) ?: return

        val sig = "${card.pay}|${card.pickupMin}|${card.tripMin}|${card.pickupMi}|${card.tripMi}"
        if (sig == lastCardSig) return
        lastCardSig = sig

        val now = SystemClock.uptimeMillis()
        if (now - lastFireAt < cooldownMs) return

        val rules = loadRules()
        val match = Rules.firstMatch(rules, card) ?: return
        Log.d(tag, "match: ${match.sound} for $card")
        play(match.sound)
        lastFireAt = now
    }

    override fun onInterrupt() {}

    private fun collectText(node: AccessibilityNodeInfo, sb: StringBuilder): StringBuilder {
        node.text?.let { sb.append(it).append('\n') }
        node.contentDescription?.let { sb.append(it).append('\n') }
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectText(child, sb)
        }
        return sb
    }

    private fun loadRules(): List<Rule> {
        val f = File(filesDir, "rules.json")
        val json = if (f.exists()) f.readText() else Rules.DEFAULT_JSON
        return try {
            Rules.parse(json)
        } catch (t: Throwable) {
            Log.w(tag, "rules parse failed: ${t.message}")
            Rules.parse(Rules.DEFAULT_JSON)
        }
    }

    private fun play(sound: String) {
        val tg = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 100)
        when (sound) {
            "loud_chime" -> tg.startTone(ToneGenerator.TONE_CDMA_HIGH_L, 600)
            "soft_ping"  -> tg.startTone(ToneGenerator.TONE_PROP_BEEP, 200)
            "silent"     -> { /* no-op */ }
            else         -> tg.startTone(ToneGenerator.TONE_PROP_BEEP, 200)
        }
    }
}
