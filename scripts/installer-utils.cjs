function ownsAppCommandLine(commandLine, appPath) {
  // Electron may replace argv with one process-title string in /proc.
  return commandLine
    .toString("utf8")
    .split("\0")
    .some(
      (arg) =>
        arg === appPath ||
        arg.endsWith(" " + appPath) ||
        arg.includes(" " + appPath + " "),
    );
}
module.exports = { ownsAppCommandLine };
