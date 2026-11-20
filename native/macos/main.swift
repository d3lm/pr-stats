import AppKit
import UserNotifications

// macOS attributes a notification to the bundle of the posting process,
// which is why this runs from inside pr-stats.app.

enum Outcome: Int32 {
  case done = 0
  case failed = 1
  case usage = 2
  case denied = 3
}

func finish(_ outcome: Outcome, _ message: String? = nil) -> Never {
  if let message {
    FileHandle.standardError.write(Data((message + "\n").utf8))
  }

  exit(outcome.rawValue)
}

let arguments = CommandLine.arguments

// macOS launches the app without arguments when the user clicks a banner.
if arguments.count == 1 {
  finish(.done)
}

guard arguments.count == 3 else {
  finish(.usage, "usage: pr-stats-notifier <title> <body>")
}

let title = arguments[1]
let body = arguments[2]

/// The pause after the completion lets the notification center settle
/// before the process exits.
func post() {
  let content = UNMutableNotificationContent()
  content.title = title
  content.body = body
  content.sound = .default

  let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)

  UNUserNotificationCenter.current().add(request) { error in
    if let error {
      finish(.failed, "could not post the notification (\(error.localizedDescription))")
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
      finish(.done)
    }
  }

  DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
    finish(.failed, "the notification center did not answer")
  }
}

/// The settings check comes first because a request against a denied app
/// fails with an error instead of a refusal. A pending prompt gets no
/// watchdog because macOS records it as refused if the process exits first.
final class Delegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    UNUserNotificationCenter.current().getNotificationSettings { settings in
      switch settings.authorizationStatus {
      case .denied:
        finish(.denied, "notifications for pr-stats are turned off in System Settings")
      case .notDetermined:
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
          if let error {
            finish(.failed, "could not request notification permission (\(error.localizedDescription))")
          }

          guard granted else {
            finish(.denied, "notifications for pr-stats were not allowed")
          }

          post()
        }
      default:
        post()
      }
    }
  }
}

let application = NSApplication.shared
let delegate = Delegate()

application.delegate = delegate
application.run()
