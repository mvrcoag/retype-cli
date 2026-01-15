import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import chalk from "chalk";
import { COLORS } from "../constants/index.js";

export interface PathInputOptions {
  message: string;
  basePath?: string;
  filter?: (entry: string) => boolean;
  validate?: (value: string) => boolean | string;
}

class ExitError extends Error {
  constructor() {
    super("User cancelled");
    this.name = "ExitError";
  }
}

export async function pathInput(options: PathInputOptions): Promise<string> {
  const { message, basePath = process.cwd(), validate, filter } = options;

  return new Promise((resolve, reject) => {
    let value = "";
    let suggestions: string[] = [];
    let selectedSuggestion = -1;
    let rendered = false;

    const getSuggestions = (input: string): string[] => {
      try {
        const inputPath = input || ".";
        const isAbsolute = path.isAbsolute(inputPath);
        const fullPath = isAbsolute ? inputPath : path.join(basePath, inputPath);

        let dirPath: string;
        let prefix: string;

        if (input.endsWith("/") || input === "") {
          dirPath = fullPath;
          prefix = input;
        } else {
          dirPath = path.dirname(fullPath);
          prefix = input.substring(0, input.lastIndexOf("/") + 1);
        }

        if (!fs.existsSync(dirPath)) {
          return [];
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const results: string[] = [];

        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;

          const entryPath = prefix + entry.name;
          const fullEntryPath = path.join(dirPath, entry.name);

          if (filter && !filter(fullEntryPath)) continue;

          if (entry.isDirectory()) {
            results.push(entryPath + "/");
          } else if (
            entry.name.endsWith(".ts") ||
            entry.name.endsWith(".tsx")
          ) {
            results.push(entryPath);
          }
        }

        const searchTerm = input.substring(input.lastIndexOf("/") + 1).toLowerCase();

        return results
          .filter((r) => {
            const name = r.substring(r.lastIndexOf("/") + 1).toLowerCase();
            return name.startsWith(searchTerm);
          })
          .slice(0, 5);
      } catch {
        return [];
      }
    };

    const render = () => {
      const totalLines = rendered ? 2 + Math.min(suggestions.length, 5) : 0;

      if (rendered && totalLines > 0) {
        process.stdout.write(`\x1b[${totalLines}A`);
        process.stdout.write("\x1b[J");
      }
      rendered = true;

      console.log(chalk.hex(COLORS.primary).bold(`? ${message}`));
      process.stdout.write(`  ${value}`);
      console.log();

      if (suggestions.length > 0) {
        suggestions.slice(0, 5).forEach((s, i) => {
          const isSelected = i === selectedSuggestion;
          const prefix = isSelected ? chalk.hex(COLORS.primary)(">") : " ";
          const text = isSelected
            ? chalk.hex(COLORS.primary)(s)
            : chalk.hex(COLORS.muted)(s);
          console.log(`${prefix} ${text}`);
        });
      }
    };

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.removeAllListeners("keypress");
      process.stdin.pause();
    };

    const complete = () => {
      const finalValue = value;
      cleanup();

      const totalLines = 2 + Math.min(suggestions.length, 5);
      process.stdout.write(`\x1b[${totalLines}A`);
      process.stdout.write("\x1b[J");

      console.log(
        chalk.hex(COLORS.primary).bold(`? ${message}`) +
          chalk.hex(COLORS.secondary)(` ${finalValue}`)
      );

      if (validate) {
        const result = validate(finalValue);
        if (result !== true) {
          const errorMsg = typeof result === "string" ? result : "Invalid input";
          console.log(chalk.hex(COLORS.error)(`  ${errorMsg}`));
          value = "";
          suggestions = [];
          selectedSuggestion = -1;
          rendered = false;

          setTimeout(() => {
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(true);
            }
            process.stdin.on("keypress", handleKeypress);
            process.stdin.resume();
            render();
          }, 100);
          return;
        }
      }

      resolve(finalValue);
    };

    const handleKeypress = (str: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === "c" && key.ctrl) {
        cleanup();
        const totalLines = 2 + Math.min(suggestions.length, 5);
        process.stdout.write(`\x1b[${totalLines}A`);
        process.stdout.write("\x1b[J");
        reject(new ExitError());
        return;
      }

      switch (key.name) {
        case "return":
          if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
            value = suggestions[selectedSuggestion];
            selectedSuggestion = -1;
            suggestions = getSuggestions(value);
            render();
          } else {
            complete();
          }
          break;

        case "tab":
          if (suggestions.length > 0) {
            selectedSuggestion = (selectedSuggestion + 1) % suggestions.length;
            render();
          }
          break;

        case "up":
        case "k":
          if (key.name === "k" && !key.ctrl) {
            value += str;
            suggestions = getSuggestions(value);
            selectedSuggestion = -1;
            render();
          } else if (suggestions.length > 0) {
            selectedSuggestion =
              selectedSuggestion <= 0
                ? suggestions.length - 1
                : selectedSuggestion - 1;
            render();
          }
          break;

        case "down":
        case "j":
          if (key.name === "j" && !key.ctrl) {
            value += str;
            suggestions = getSuggestions(value);
            selectedSuggestion = -1;
            render();
          } else if (suggestions.length > 0) {
            selectedSuggestion = (selectedSuggestion + 1) % suggestions.length;
            render();
          }
          break;

        case "backspace":
          if (value.length > 0) {
            value = value.slice(0, -1);
            suggestions = getSuggestions(value);
            selectedSuggestion = -1;
            render();
          }
          break;

        case "escape":
          cleanup();
          const totalLines = 2 + Math.min(suggestions.length, 5);
          process.stdout.write(`\x1b[${totalLines}A`);
          process.stdout.write("\x1b[J");
          reject(new ExitError());
          break;

        default:
          if (str && str.length === 1 && !key.ctrl && !key.meta) {
            value += str;
            suggestions = getSuggestions(value);
            selectedSuggestion = -1;
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

    suggestions = getSuggestions(value);
    render();
  });
}
