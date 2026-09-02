import AppKit
import UserNotifications

// Posts one macOS notification on behalf of the pr-stats app bundle and
// exits. The TUI spawns this binary from inside pr-stats.app, because the
// notification center attributes a notification to the bundle of the
// process that posts it, and that attribution decides the icon, the name
// on the banner, and the entry under System Settings › Notifications. The
// unbundled osascript gets attributed to Script Editor for the same
// reason. The first run asks the user for permission and later runs
// answer from the stored decision. The exit codes below reach the TUI,
// which turns them into footer messages.

/// Names the exit codes the TUI maps to messages. Denied means the user
/// turned notifications off for pr-stats, or never answered the
/// permission prompt, which macOS records as a refusal.
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

// A click on a banner makes macOS open the app without arguments, and
// there is nothing to do then.
if arguments.count == 1 {
  finish(.done)
}

guard arguments.count == 3 else {
  finish(.usage, "usage: pr-stats-notifier <title> <body>")
}

let title = arguments[1]
let body = arguments[2]

/// Hands the notification to the notification center once permission is
/// settled. The center has accepted the request when the completion
/// runs, and a short pause lets it settle before the process goes away.
/// A watchdog covers a center that never answers, and it can start here
/// because no permission prompt is pending anymore by this point.
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

/// Drives the send from the application lifecycle, because the
/// notification center needs a running main loop and a bundled process.
/// The settings check comes first because on macOS a request against a
/// denied app fails with an error instead of a plain refusal, and the
/// TUI wants the denial told apart from a broken send. A pending prompt
/// gets no watchdog on purpose. macOS records the prompt as refused when
/// the requesting process exits before the user answers, so the process
/// waits for the answer however long that takes.
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
