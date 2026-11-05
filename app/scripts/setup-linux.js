const os = require("node:os");
const platform = require("../platform");

try {
  if (!platform.isLinux)
    throw new Error("This setup command is for Linux only.");
  const result = platform.installLinuxDesktop({
    home: os.homedir(),
    electronPath: require("electron"),
    hyprland: process.argv.includes("--hyprland"),
    capturePlugin: process.argv.includes("--capture-plugin"),
  });
  console.log(`Launcher: ${result.launcher}\nDesktop entry: ${result.desktop}`);
  if (result.hyprland)
    console.log(
      "Hyprland integration installed. Reload Hyprland and check configerrors.",
    );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
