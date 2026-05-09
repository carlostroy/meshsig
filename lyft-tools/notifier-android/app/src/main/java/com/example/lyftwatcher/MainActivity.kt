package com.example.lyftwatcher

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 48)
        }

        val title = TextView(this).apply {
            text = "Lyft Watcher"
            textSize = 22f
        }
        val info = TextView(this).apply {
            text = "1) Enable accessibility service.\n" +
                   "2) Edit rules.json in this app's files dir.\n" +
                   "3) Open Lyft Driver and go online."
            setPadding(0, 24, 0, 32)
        }

        val accBtn = Button(this).apply {
            text = "Open Accessibility settings"
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }

        val rulesBtn = Button(this).apply {
            text = "Reset rules.json to defaults"
            setOnClickListener {
                val f = File(filesDir, "rules.json")
                f.writeText(Rules.DEFAULT_JSON)
                info.text = "rules.json reset.\nPath: ${f.absolutePath}"
            }
        }

        val pathView = TextView(this).apply {
            val f = File(filesDir, "rules.json")
            text = "rules.json:\n${f.absolutePath}"
            setPadding(0, 32, 0, 0)
        }

        root.addView(title)
        root.addView(info)
        root.addView(accBtn)
        root.addView(rulesBtn)
        root.addView(pathView)
        setContentView(root)
    }
}
