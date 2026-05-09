import ReplayKit
import Vision
import CoreImage
import UserNotifications

class SampleHandler: RPBroadcastSampleHandler {

    private let ocrQueue = DispatchQueue(label: "com.lyftadvisor.ocr", qos: .userInitiated)
    private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
    private var isProcessing = false
    private var lastProcessedAt: TimeInterval = 0
    private let throttleInterval: TimeInterval = 0.5
    private var lastDecisionKey: String = ""
    private var lastDecisionFiredAt: TimeInterval = 0

    override func broadcastStarted(withSetupInfo setupInfo: [String : NSObject]?) {
        scheduleNotification(
            title: "📡 Lyft Advisor ativo",
            body: "Lendo cards. Vai pro Lyft Driver.",
            sound: .default
        )
    }

    override func broadcastPaused() {}
    override func broadcastResumed() {}

    override func broadcastFinished() {
        scheduleNotification(
            title: "Lyft Advisor parado",
            body: "Transmissão encerrada.",
            sound: nil
        )
    }

    override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
        guard sampleBufferType == .video else { return }
        guard !isProcessing else { return }

        let now = CACurrentMediaTime()
        if now - lastProcessedAt < throttleInterval { return }
        lastProcessedAt = now

        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        isProcessing = true
        let bufferCopy = pixelBuffer

        ocrQueue.async { [weak self] in
            guard let self = self else { return }
            defer { self.isProcessing = false }
            self.runOCR(on: bufferCopy)
        }
    }

    private func runOCR(on pixelBuffer: CVPixelBuffer) {
        let request = VNRecognizeTextRequest { [weak self] request, _ in
            guard let self = self,
                  let observations = request.results as? [VNRecognizedTextObservation] else { return }

            let lines = observations.compactMap { $0.topCandidates(1).first?.string }
            let fullText = lines.joined(separator: "\n")

            self.handleRecognizedText(fullText)
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.recognitionLanguages = ["pt-BR", "pt-PT", "en-US"]
        request.minimumTextHeight = 0.012

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        try? handler.perform([request])
    }

    private func handleRecognizedText(_ text: String) {
        guard text.lowercased().contains("hora") || text.lowercased().contains("/hr") || text.contains("US$") else {
            return
        }

        guard let card = CardParser.parse(text: text) else { return }
        guard card.pay != nil, card.computedPerHour() != nil else { return }

        let rules = SharedDefaults.loadRules()
        let decision = RulesEngine.evaluate(card: card, rules: rules)

        let key = String(format: "%.2f-%.2f-%.0f-%.1f-%.0f-%.1f",
                         card.pay ?? 0,
                         card.computedPerHour() ?? 0,
                         card.pickupMin ?? 0,
                         card.pickupMi ?? 0,
                         card.tripMin ?? 0,
                         card.tripMi ?? 0)

        let now = CACurrentMediaTime()
        if key == lastDecisionKey && now - lastDecisionFiredAt < 30 {
            return
        }
        lastDecisionKey = key
        lastDecisionFiredAt = now

        SharedDefaults.saveLastDecision(
            verdict: decision.verdict.rawValue,
            summary: decision.summary,
            reasons: decision.reasons
        )

        fireDecisionNotification(decision)
    }

    private func fireDecisionNotification(_ decision: Decision) {
        let title = decision.headline
        let body = "\(decision.summary)\n\(decision.reasons.joined(separator: " · "))"
        let sound: UNNotificationSound? = {
            switch decision.verdict {
            case .accept: return .defaultCritical
            case .maybe: return .default
            case .reject: return .default
            }
        }()
        scheduleNotification(title: title, body: body, sound: sound, threadId: "ride-decision")
    }

    private func scheduleNotification(title: String, body: String, sound: UNNotificationSound?, threadId: String? = nil) {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        if let sound = sound { content.sound = sound }
        content.interruptionLevel = .timeSensitive
        if let threadId = threadId { content.threadIdentifier = threadId }

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }
}
