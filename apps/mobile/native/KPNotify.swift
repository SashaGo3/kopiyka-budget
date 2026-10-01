import Foundation
import UserNotifications

/**
 What the Shortcut automation says after it logs a payment (`LogPaymentIntent`).

 The automation runs with the app closed, so without a word from it a purchase only turns up in a
 list days later. One notification per payment, then — but never a pile of them: a bank that reports
 a busy Saturday leaves ten notices nobody reads, and Notification Center is not a transaction log.
 So every one of these carries the same `threadIdentifier`, and posting a new one removes the
 delivered ones first. The last payment is the one on screen.

 Deliberately not a fixed identifier for the request itself, which would also replace the banner:
 the app follows a tapped notification by identifier and remembers the last one it followed
 (`src/app/_layout.tsx`), so a reused id would make the second tap of a session do nothing.

 Nothing here asks for permission. An intent runs in the background off a notification, where a
 permission prompt has nobody in front of it; `add` simply fails when notifications are not allowed,
 and Settings → Automate with Shortcut is where that is said out loud.
 */
enum KPNotify {
  static let paymentThread = "kopiyka.shortcut"

  /// Post the one payment notification, replacing whatever the automation last put on screen.
  /// `badge` is how many entries are waiting in the Pending queue; nil leaves the badge alone.
  static func payment(id: String, title: String, body: String, badge: Int?) async {
    let center = UNUserNotificationCenter.current()
    guard await center.notificationSettings().authorizationStatus == .authorized else { return }

    let delivered = await center.deliveredNotifications()
    let ours = delivered.filter { $0.request.content.threadIdentifier == paymentThread }.map(\.request.identifier)
    if !ours.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ours) }

    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.threadIdentifier = paymentThread
    // Tapping goes to the entry itself, which is the only thing there is to do about it.
    content.userInfo = ["url": "\(KP.scheme)://transaction/\(id)"]
    if let badge { content.badge = NSNumber(value: badge) }
    content.sound = nil   // it is a receipt, not an alarm; the bank already made the noise

    try? await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
  }
}
