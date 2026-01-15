import * as readline from "readline";
import chalk from "chalk";
import { COLORS } from "../constants/index.js";
import { logger } from "./logger.js";

export interface SelectChoice<T> {
  name: string;
  value: T;
  disabled?: boolean;
}

export interface SelectOptions<T> {
  message: string;
  choices: SelectChoice<T>[];
}

export interface InputOptions {
  message: string;
  validate?: (value: string) => boolean | string;
  default?: string;
}

export interface ConfirmOptions {
  message: string;
  default?: boolean;
}

class ExitError extends Error {
  constructor() {
    super("User cancelled");
    this.name = "ExitError";
  }
}

export function isExitError(error: unknown): error is ExitError {
  return error instanceof ExitError;
}

export async function vimSelect<T>(options: SelectOptions<T>): Promise<T> {
  const { message, choices } = options;
  const enabledChoices = choices.filter((c) => !c.disabled);

  if (enabledChoices.length === 0) {
    throw new Error("No choices available");
  }

  return new Promise((resolve, reject) => {
    let cursor = 0;
    let rendered = false;

    const render = () => {
      if (rendered) {
        process.stdout.write(`\x1b[${choices.length + 1}A`);
        process.stdout.write("\x1b[J");
      }
      rendered = true;

      console.log(chalk.hex(COLORS.primary).bold(`? ${message}`));

      choices.forEach((choice, i) => {
        const isCursor = i === cursor;
        const prefix = isCursor ? chalk.hex(COLORS.primary)(">") : " ";

        if (choice.disabled) {
          console.log(`${prefix} ${chalk.hex(COLORS.muted)(choice.name)} (disabled)`);
        } else if (isCursor) {
          console.log(`${prefix} ${chalk.hex(COLORS.primary).bold(choice.name)}`);
        } else {
          console.log(`${prefix} ${choice.name}`);
        }
      });
    };

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeAllListeners("keypress");
      process.stdin.pause();
    };

    const handleKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === "c" && key.ctrl) {
        cleanup();
        process.stdout.write(`\x1b[${choices.length + 1}A`);
        process.stdout.write("\x1b[J");
        reject(new ExitError());
        return;
      }

      switch (key.name) {
        case "up":
        case "k":
          do {
            cursor = cursor > 0 ? cursor - 1 : choices.length - 1;
          } while (choices[cursor].disabled);
          render();
          break;
        case "down":
        case "j":
          do {
            cursor = cursor < choices.length - 1 ? cursor + 1 : 0;
          } while (choices[cursor].disabled);
          render();
          break;
        case "return":
          cleanup();
          process.stdout.write(`\x1b[${choices.length + 1}A`);
          process.stdout.write("\x1b[J");
          console.log(
            chalk.hex(COLORS.primary).bold(`? ${message}`) +
              chalk.hex(COLORS.secondary)(` ${choices[cursor].name}`)
          );
          resolve(choices[cursor].value);
          break;
        case "q":
        case "escape":
          cleanup();
          process.stdout.write(`\x1b[${choices.length + 1}A`);
          process.stdout.write("\x1b[J");
          reject(new ExitError());
          break;
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("keypress", handleKeypress);
    process.stdin.resume();

    render();
  });
}

export async function vimInput(options: InputOptions): Promise<string> {
  const { message, validate, default: defaultValue } = options;

  return new Promise((resolve, reject) => {
    let value = defaultValue || "";
    let errorMsg = "";

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = () => {
      const displayMsg = chalk.hex(COLORS.primary).bold(`? ${message} `);
      rl.question(displayMsg, (answer) => {
        value = answer;

        if (validate) {
          const result = validate(value);
          if (result !== true) {
            errorMsg = typeof result === "string" ? result : "Invalid input";
            console.log(chalk.hex(COLORS.error)(`  ${errorMsg}`));
            prompt();
            return;
          }
        }

        rl.close();
        resolve(value);
      });
    };

    rl.on("close", () => {
      // Handle Ctrl+C
    });

    rl.on("SIGINT", () => {
      rl.close();
      console.log();
      reject(new ExitError());
    });

    prompt();
  });
}

export async function vimConfirm(options: ConfirmOptions): Promise<boolean> {
  const { message, default: defaultValue = true } = options;

  return new Promise((resolve, reject) => {
    let value = defaultValue;
    let rendered = false;

    const render = () => {
      if (rendered) {
        process.stdout.write("\x1b[1A");
        process.stdout.write("\x1b[J");
      }
      rendered = true;

      const yesStyle = value
        ? chalk.hex(COLORS.secondary).bold("Yes")
        : chalk.hex(COLORS.muted)("Yes");
      const noStyle = !value
        ? chalk.hex(COLORS.warning).bold("No")
        : chalk.hex(COLORS.muted)("No");

      console.log(
        chalk.hex(COLORS.primary).bold(`? ${message}`) +
          ` ${yesStyle} / ${noStyle}`
      );
    };

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeAllListeners("keypress");
      process.stdin.pause();
    };

    const handleKeypress = (str: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === "c" && key.ctrl) {
        cleanup();
        process.stdout.write("\x1b[1A");
        process.stdout.write("\x1b[J");
        reject(new ExitError());
        return;
      }

      switch (key.name) {
        case "left":
        case "right":
        case "h":
        case "l":
        case "j":
        case "k":
        case "tab":
          value = !value;
          render();
          break;
        case "return":
          cleanup();
          process.stdout.write("\x1b[1A");
          process.stdout.write("\x1b[J");
          console.log(
            chalk.hex(COLORS.primary).bold(`? ${message}`) +
              chalk.hex(COLORS.secondary)(` ${value ? "Yes" : "No"}`)
          );
          resolve(value);
          break;
        case "escape":
        case "q":
          cleanup();
          process.stdout.write("\x1b[1A");
          process.stdout.write("\x1b[J");
          reject(new ExitError());
          break;
        default:
          if (str === "y" || str === "Y") {
            value = true;
            render();
          } else if (str === "n" || str === "N") {
            value = false;
            render();
          }
          break;
      }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.on("keypress", handleKeypress);
    process.stdin.resume();

    render();
  });
}

export function setupGracefulExit(): void {
  process.on("SIGINT", () => {
    logger.newLine();
    logger.infoLog("Interrupted. Goodbye!");
    process.exit(0);
  });

  process.on("uncaughtException", (error) => {
    if (isExitError(error)) {
      logger.newLine();
      logger.infoLog("Cancelled. Goodbye!");
      process.exit(0);
    }
    throw error;
  });
}
