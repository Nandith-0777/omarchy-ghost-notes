import QtQuick
import Quickshell
import qs.Ui as Ui

Ui.BarWidget {
  id: root
  moduleName: "io.github.nandith-0777.ghost-notes"
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function launch(action) {
    const script = decodeURIComponent(Qt.resolvedUrl("scripts/launch.sh").toString().replace(/^file:\/\//, ""))
    Quickshell.execDetached(["bash", script, action])
  }

  Ui.WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󰊠"
    tooltipText: "Ghost Notes · Click: notes · Right-click: new note"
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.LeftButton) root.launch("manager")
      else if (buttonCode === Qt.RightButton) root.launch("new")
    }
  }
}
