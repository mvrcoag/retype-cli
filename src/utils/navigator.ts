import * as readline from "readline";
import chalk from "chalk";
import { Entity } from "../types/index.js";
import { COLORS, ICONS } from "../constants/index.js";

export interface NavigatorOptions {
  items: Entity[];
  showBody?: boolean;
  multiSelect?: boolean;
  pageSize?: number;
  title?: string;
}

export interface NavigatorResult {
  selected: Entity[];
  cancelled: boolean;
}

export class EntityNavigator {
  private items: Entity[];
  private showBody: boolean;
  private multiSelect: boolean;
  private pageSize: number;
  private title: string;
  private cursor: number = 0;
  private offset: number = 0;
  private selectedIndices: Set<number> = new Set();
  private resolve: ((result: NavigatorResult) => void) | null = null;
  private lastRenderedLines: number = 0;
  private isFirstRender: boolean = true;

  constructor(options: NavigatorOptions) {
    this.items = options.items;
    this.showBody = options.showBody ?? false;
    this.multiSelect = options.multiSelect ?? false;
    this.pageSize = options.pageSize ?? 10;
    this.title = options.title ?? "Results";
  }

  async navigate(): Promise<NavigatorResult> {
    if (this.items.length === 0) {
      return { selected: [], cancelled: false };
    }

    return new Promise((resolve) => {
      this.resolve = resolve;

      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }

      process.stdin.on("keypress", this.handleKeypress.bind(this));
      process.stdin.resume();

      this.render();
    });
  }

  private handleKeypress(_str: string, key: readline.Key): void {
    if (!key) return;

    switch (key.name) {
      case "up":
      case "k":
        this.moveCursor(-1);
        break;
      case "down":
      case "j":
        this.moveCursor(1);
        break;
      case "space":
        if (this.multiSelect) {
          this.toggleSelection();
        }
        break;
      case "return":
        this.confirm();
        break;
      case "q":
      case "escape":
        this.cancel();
        break;
      case "b":
        this.showBody = !this.showBody;
        this.render();
        break;
      case "c":
        if (key.ctrl) {
          this.cancel();
        }
        break;
    }
  }

  private moveCursor(delta: number): void {
    const newCursor = this.cursor + delta;

    if (newCursor >= 0 && newCursor < this.items.length) {
      this.cursor = newCursor;

      if (this.cursor < this.offset) {
        this.offset = this.cursor;
      } else if (this.cursor >= this.offset + this.pageSize) {
        this.offset = this.cursor - this.pageSize + 1;
      }

      this.render();
    }
  }

  private toggleSelection(): void {
    if (this.selectedIndices.has(this.cursor)) {
      this.selectedIndices.delete(this.cursor);
    } else {
      this.selectedIndices.add(this.cursor);
    }
    this.render();
  }

  private confirm(): void {
    let selected: Entity[];

    if (this.multiSelect) {
      if (this.selectedIndices.size === 0) {
        selected = [this.items[this.cursor]];
      } else {
        selected = Array.from(this.selectedIndices)
          .sort((a, b) => a - b)
          .map((i) => this.items[i]);
      }
    } else {
      selected = [this.items[this.cursor]];
    }

    this.cleanup();
    this.resolve?.({ selected, cancelled: false });
  }

  private cancel(): void {
    this.cleanup();
    this.resolve?.({ selected: [], cancelled: true });
  }

  private cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeAllListeners("keypress");
    process.stdin.pause();
    this.clearDisplay();
  }

  private clearDisplay(): void {
    if (this.lastRenderedLines > 0) {
      process.stdout.write(`\x1b[${this.lastRenderedLines}A`);
      process.stdout.write("\x1b[J");
    }
  }

  private render(): void {
    if (!this.isFirstRender) {
      this.clearDisplay();
    }
    this.isFirstRender = false;

    const output: string[] = [];

    output.push(
      chalk.hex(COLORS.primary).bold(`${this.title} `) +
        chalk.hex(COLORS.muted)(`(${this.items.length} items)`)
    );
    output.push(chalk.hex(COLORS.muted)("-".repeat(60)));

    const visibleItems = this.items.slice(
      this.offset,
      this.offset + this.pageSize
    );

    visibleItems.forEach((item, i) => {
      const actualIndex = this.offset + i;
      const isCursor = actualIndex === this.cursor;
      const isSelected = this.selectedIndices.has(actualIndex);

      const prefix = this.getPrefix(isCursor, isSelected);
      const icon = this.getEntityIcon(item.kind);
      const name = isCursor
        ? chalk.hex(COLORS.primary).bold(item.name)
        : item.name;
      const location = chalk.hex(COLORS.muted)(
        `${item.filePath.split("/").slice(-2).join("/")}:${item.line}`
      );
      const exported = item.isExported
        ? chalk.hex(COLORS.secondary)(" [exp]")
        : "";

      output.push(`${prefix} ${icon} ${name} ${location}${exported}`);
    });

    if (this.items.length > this.pageSize) {
      const scrollInfo = chalk.hex(COLORS.muted)(
        `  (${this.offset + 1}-${Math.min(this.offset + this.pageSize, this.items.length)} of ${this.items.length})`
      );
      output.push(scrollInfo);
    }

    if (this.showBody) {
      output.push(chalk.hex(COLORS.muted)("-".repeat(60)));
      output.push(chalk.hex(COLORS.info).bold("Code Preview:"));
      const bodyLines = this.getEntityBody(this.items[this.cursor]);
      output.push(...bodyLines);
    }

    output.push("");
    output.push(this.getHelpLine());

    const finalOutput = output.join("\n");
    process.stdout.write(finalOutput + "\n");

    this.lastRenderedLines = output.length;
  }

  private getPrefix(isCursor: boolean, isSelected: boolean): string {
    if (this.multiSelect) {
      const checkbox = isSelected
        ? chalk.hex(COLORS.secondary)("[x]")
        : chalk.hex(COLORS.muted)("[ ]");
      const cursor = isCursor ? chalk.hex(COLORS.primary)(">") : " ";
      return `${cursor} ${checkbox}`;
    }
    return isCursor ? chalk.hex(COLORS.primary)(">") : " ";
  }

  private getEntityIcon(kind: string): string {
    const icon = ICONS[kind as keyof typeof ICONS] || "?";
    return chalk.hex(COLORS.primary)(`[${icon}]`);
  }

  private getEntityBody(entity: Entity): string[] {
    const lines: string[] = [];
    const maxLines = 8;

    try {
      const sourceFile = entity.sourceFile;
      const fullText = sourceFile.getFullText();
      const textLines = fullText.split("\n");

      const startLine = Math.max(0, entity.line - 1);
      const endLine = Math.min(textLines.length, startLine + maxLines);

      for (let i = startLine; i < endLine; i++) {
        const lineNum = chalk.hex(COLORS.muted)(
          String(i + 1).padStart(4, " ") + " |"
        );
        const lineContent = textLines[i] || "";
        const truncated =
          lineContent.length > 70
            ? lineContent.substring(0, 70) + "..."
            : lineContent;

        if (i === entity.line - 1) {
          lines.push(`${lineNum} ${chalk.hex(COLORS.primary)(truncated)}`);
        } else {
          lines.push(`${lineNum} ${truncated}`);
        }
      }
    } catch {
      lines.push(chalk.hex(COLORS.muted)("Unable to load source"));
    }

    while (lines.length < maxLines) {
      lines.push("");
    }

    return lines;
  }

  private getHelpLine(): string {
    const parts: string[] = [];

    parts.push(`${chalk.hex(COLORS.muted)("j/k")} nav`);

    if (this.multiSelect) {
      parts.push(`${chalk.hex(COLORS.muted)("space")} select`);
    }

    parts.push(`${chalk.hex(COLORS.muted)("enter")} ok`);
    parts.push(
      `${chalk.hex(COLORS.muted)("b")} ${this.showBody ? "hide" : "show"} code`
    );
    parts.push(`${chalk.hex(COLORS.muted)("q")} quit`);

    return parts.join(chalk.hex(COLORS.muted)(" | "));
  }
}

export async function navigateEntities(
  options: NavigatorOptions
): Promise<NavigatorResult> {
  const navigator = new EntityNavigator(options);
  return navigator.navigate();
}
