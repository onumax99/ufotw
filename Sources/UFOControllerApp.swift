import SwiftUI

@main
struct UFOControllerApp: App {
    @StateObject private var device: UFOTWController
    @StateObject private var model: ControlModel

    init() {
        let device = UFOTWController()
        _device = StateObject(wrappedValue: device)
        _model = StateObject(wrappedValue: ControlModel(device: device))
    }

    var body: some Scene {
        WindowGroup {
            ContentView(device: device, model: model)
        }
    }
}
