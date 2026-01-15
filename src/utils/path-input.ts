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
  initialPath?: string;
  showHint?: boolean;
}

class ExitError extends Error {
  constructor() {
    super("User cancelled");
    this.name = "ExitError";
  }
}

export async function pathInput(options: PathInputOptions): Promise<string> {
  const { message, basePath = process.cwd(), validate, filter, initialPath = "", showHint = true } = options;

  return new Promise((resolve, reject) => {
    let value = initialPath;
    let suggestions: string[] = [];
    let selectedSuggestion = -1;
    let previousLineCount = 0;

    const getSuggestions = (input: string): string[] => {
      try {
        const inputPath = input || ".";
        const isAbsolute = path.isAbsolute(inputPath);
        const fullPath = isAbsolute ? inputPath : path.join(basePath, inputPath);

        let dirPath: string;
        let prefix: string;
        let searchTerm: string;

        if (input.endsWith("/") || input === "") {
          // User typed a full directory path, show contents
          dirPath = fullPath;
          prefix = input;
          searchTerm = "";
        } else {
          // User is typing a partial name, filter by it
          dirPath = path.dirname(fullPath);
          const lastSlash = input.lastIndexOf("/");
          prefix = lastSlash >= 0 ? input.substring(0, lastSlash + 1) : "";
          searchTerm = lastSlash >= 0 ? input.substring(lastSlash + 1).toLowerCase() : input.toLowerCase();
        }

        if (!fs.existsSync(dirPath)) {
          return [];
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        const results: string[] = [];

        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;

          const fullEntryPath = path.join(dirPath, entry.name);
          if (filter && !filter(fullEntryPath)) continue;

          // Filter by search term
          if (searchTerm && !entry.name.toLowerCase().startsWith(searchTerm)) {
            continue;
          }

          const entryPath = prefix + entry.name;

          if (entry.isDirectory()) {
            results.push(entryPath + "/");
          } else if (
            entry.name.endsWith(".ts") ||
            entry.name.endsWith(".tsx")
          ) {
            results.push(entryPath);
          }
        }

        // Sort: directories first, then files
        results.sort((a, b) => {
          const aIsDir = a.endsWith("/");
          const bIsDir = b.endsWith("/");
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;
          return a.localeCompare(b);
        });

        return results.slice(0, 5);
      } catch {
        return [];
      }
    };

    const render = () => {
      // Clear previous output
      if (previousLineCount > 0) {
        process.stdout.write(`\x1b[${previousLineCount}A`);
        process.stdout.write("\x1b[J");
      }

      // Calculate new line count
      const hintLine = showHint ? 1 : 0;
      const suggestionLines = Math.min(suggestions.length, 5);
      previousLineCount = 2 + hintLine + suggestionLines; // message + hint + input line + suggestions

      // Render message
      console.log(chalk.hex(COLORS.primary).bold(`? ${message}`));

      // Render hint
      if (showHint) {
        console.log(chalk.hex(COLORS.muted)("  Tab: complete  Up/Down: navigate  Enter: confirm"));
      }

      // Render input with cursor
      process.stdout.write(`  ${value}`);
      console.log();

      // Render suggestions
      if (suggestions.length > 0) {
        suggestions.forEach((s, i) => {
          const isSelected = i === selectedSuggestion;
          const marker = isSelected ? chalk.hex(COLORS.primary)(">") : " ";
          const text = isSelected
            ? chalk.hex(COLORS.primary)(s)
            : chalk.hex(COLORS.muted)(s);
          console.log(`${marker} ${text}`);
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

      // Clear and show final result
      if (previousLineCount > 0) {
        process.stdout.write(`\x1b[${previousLineCount}A`);
        process.stdout.write("\x1b[J");
      }

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
          previousLineCount = 0;

          setTimeout(() => {
            readline.emitKeypressEvents(process.stdin);
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(true);
            }
            process.stdin.on("keypress", handleKeypress);
            process.stdin.resume();
            suggestions = getSuggestions(value);
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
        if (previousLineCount > 0) {
          process.stdout.write(`\x1b[${previousLineCount}A`);
          process.stdout.write("\x1b[J");
        }
        reject(new ExitError());
        return;
      }

      switch (key.name) {
        case "return":
          if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
            // Apply selected suggestion
            value = suggestions[selectedSuggestion];
            selectedSuggestion = -1;
            suggestions = getSuggestions(value);
            render();
          } else {
            // Complete input
            complete();
          }
          break;

        case "tab":
          if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
            // Apply selected suggestion on Tab
            value = suggestions[selectedSuggestion];
            selectedSuggestion = -1;
            suggestions = getSuggestions(value);
            render();
          } else if (suggestions.length === 1) {
            // Auto-complete if only one suggestion
            value = suggestions[0];
            suggestions = getSuggestions(value);
            selectedSuggestion = -1;
            render();
          } else if (suggestions.length > 0) {
            // Cycle through suggestions
            selectedSuggestion = (selectedSuggestion + 1) % suggestions.length;
            render();
          }
          break;

        case "up":
          if (suggestions.length > 0) {
            selectedSuggestion =
              selectedSuggestion <= 0
                ? suggestions.length - 1
                : selectedSuggestion - 1;
            render();
          }
          break;

        case "down":
          if (suggestions.length > 0) {
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
          if (previousLineCount > 0) {
            process.stdout.write(`\x1b[${previousLineCount}A`);
            process.stdout.write("\x1b[J");
          }
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

    // Initial render with suggestions
    suggestions = getSuggestions(value);
    render();
  });
}
