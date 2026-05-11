import Capacitor
import UIKit

class CrewCmdBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(CrewCmdVoiceSessionPlugin())
    }
}
