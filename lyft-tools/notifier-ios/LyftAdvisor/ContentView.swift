import SwiftUI
import ReplayKit

struct ContentView: View {
    @State private var rules = SharedDefaults.loadRules()
    @State private var showingPicker = false
    @State private var lastDecision: [String: Any]? = SharedDefaults.loadLastDecision()

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    BroadcastButtonView()
                        .frame(height: 60)
                        .frame(maxWidth: .infinity)
                } header: {
                    Text("1. Iniciar transmissão de tela")
                } footer: {
                    Text("Aperta o botão acima → escolhe \"Lyft Advisor\" → \"Iniciar Transmissão\". A barrinha vermelha aparece em cima da tela. Aí volta pro Lyft Driver e dirige normal.")
                }

                Section("Pay mínimo absoluto") {
                    HStack {
                        Text("$")
                        TextField("6.00", value: $rules.minPay, format: .number)
                            .keyboardType(.decimalPad)
                    }
                }

                Section("$/hora mínimo (PEGA acima disso)") {
                    HStack {
                        Text("$")
                        TextField("25", value: $rules.minPerHour, format: .number)
                            .keyboardType(.decimalPad)
                        Text("/hr")
                    }
                }

                Section("$/hora — RECUSA abaixo disso") {
                    HStack {
                        Text("$")
                        TextField("20", value: $rules.minPerHourMaybe, format: .number)
                            .keyboardType(.decimalPad)
                        Text("/hr")
                    }
                    Text("Entre os dois valores = TALVEZ").font(.caption).foregroundStyle(.secondary)
                }

                Section("$/milha mínimo (na corrida)") {
                    HStack {
                        Text("$")
                        TextField("1.00", value: $rules.minPerMileTrip, format: .number)
                            .keyboardType(.decimalPad)
                        Text("/mi")
                    }
                }

                Section("Pickup máximo (% do tempo total)") {
                    HStack {
                        Slider(value: $rules.maxPickupRatio, in: 0.15...0.50, step: 0.05)
                        Text("\(Int(rules.maxPickupRatio * 100))%").monospacedDigit()
                    }
                }

                Section("Pickup máximo absoluto (minutos)") {
                    HStack {
                        TextField("12", value: $rules.maxPickupMin, format: .number)
                            .keyboardType(.decimalPad)
                        Text("min")
                    }
                }

                Section("Última decisão") {
                    if let d = lastDecision,
                       let v = d["verdict"] as? String,
                       let s = d["summary"] as? String {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(verdictHeadline(v)).font(.headline)
                            Text(s).font(.caption).foregroundStyle(.secondary)
                            if let r = d["reasons"] as? [String], !r.isEmpty {
                                Text(r.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    } else {
                        Text("Nenhuma corrida processada ainda")
                            .foregroundStyle(.secondary)
                    }
                    Button("Atualizar") { lastDecision = SharedDefaults.loadLastDecision() }
                }

                Section {
                    Button("Salvar regras") {
                        SharedDefaults.saveRules(rules)
                    }
                    .frame(maxWidth: .infinity)
                    .buttonStyle(.borderedProminent)
                }
            }
            .navigationTitle("Lyft Advisor")
            .onChange(of: rules) { _, newValue in
                SharedDefaults.saveRules(newValue)
            }
        }
    }

    private func verdictHeadline(_ raw: String) -> String {
        switch raw {
        case "accept": return "✅ PEGA"
        case "maybe": return "⚠️ TALVEZ"
        case "reject": return "❌ RECUSA"
        default: return raw
        }
    }
}

struct BroadcastButtonView: UIViewRepresentable {
    func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
        let picker = RPSystemBroadcastPickerView(frame: .zero)
        picker.preferredExtension = "com.lyftadvisor.broadcast"
        picker.showsMicrophoneButton = false
        return picker
    }
    func updateUIView(_ uiView: RPSystemBroadcastPickerView, context: Context) {}
}
