import chalk from "chalk";
import boxen from "boxen";
import ora, { Ora } from "ora";
import {
  COLORS,
  ICONS,
  APP_NAME,
  APP_VERSION,
  APP_DESCRIPTION,
} from "../constants/index.js";

class Logger {
  private spinner: Ora | null = null;

  primary(text: string): string {
    return chalk.hex(COLORS.primary)(text);
  }

  secondary(text: string): string {
    return chalk.hex(COLORS.secondary)(text);
  }

  warning(text: string): string {
    return chalk.hex(COLORS.warning)(text);
  }

  error(text: string): string {
    return chalk.hex(COLORS.error)(text);
  }

  info(text: string): string {
    return chalk.hex(COLORS.info)(text);
  }

  muted(text: string): string {
    return chalk.hex(COLORS.muted)(text);
  }

  bold(text: string): string {
    return chalk.bold(text);
  }

  dim(text: string): string {
    return chalk.dim(text);
  }

  success(message: string): void {
    console.log(`${chalk.green(ICONS.success)} ${message}`);
  }

  errorLog(message: string): void {
    console.log(`${chalk.red(ICONS.error)} ${message}`);
  }

  warnLog(message: string): void {
    console.log(`${chalk.yellow(ICONS.warning)} ${message}`);
  }

  infoLog(message: string): void {
    console.log(`${chalk.blue(ICONS.info)} ${message}`);
  }

  log(message: string): void {
    console.log(message);
  }

  newLine(): void {
    console.log();
  }

  banner(): void {
    const banner = boxen(
      chalk.hex(COLORS.primary).bold(APP_NAME) +
        " " +
        chalk.hex(COLORS.secondary)(`v${APP_VERSION}`) +
        "\n" +
        chalk.hex(COLORS.muted)(APP_DESCRIPTION),
      {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "#7C3AED",
      },
    );
    console.log(banner);
  }

  box(title: string, content: string): void {
    const box = boxen(content, {
      title,
      titleAlignment: "left",
      padding: 1,
      borderStyle: "round",
      borderColor: "#7C3AED",
    });
    console.log(box);
  }

  startSpinner(text: string): void {
    this.spinner = ora({
      text,
      color: "magenta",
    }).start();
  }

  updateSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.text = text;
    }
  }

  succeedSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.succeed(text);
      this.spinner = null;
    }
  }

  failSpinner(text: string): void {
    if (this.spinner) {
      this.spinner.fail(text);
      this.spinner = null;
    }
  }

  stopSpinner(): void {
    if (this.spinner) {
      this.spinner.stop();
      this.spinner = null;
    }
  }

  entityIcon(kind: string): string {
    const icon = ICONS[kind as keyof typeof ICONS] || "?";
    return chalk.hex(COLORS.primary)(`[${icon}]`);
  }

  filePath(path: string): string {
    return chalk.hex(COLORS.info).underline(path);
  }

  lineInfo(line: number, column: number): string {
    return chalk.hex(COLORS.muted)(`:${line}:${column}`);
  }
}

export const logger = new Logger();
