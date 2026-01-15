import { Command } from "commander";
import Table from "cli-table3";
import { importsService, FixableImport } from "../../services/imports.service.js";
import { logger } from "../../utils/logger.js";
import { navigateEntities } from "../../utils/navigator.js";
import { vimConfirm, vimSelect } from "../../utils/prompts.js";

export function createFixImportsCommand(): Command {
  const command = new Command("fix-imports")
    .alias("fi")
    .description("Find and fix missing imports in the codebase")
    .option("-l, --list", "Show as simple list without interaction")
    .option("-a, --auto", "Auto-fix all single-candidate imports")
    .action(async (options) => {
      await executeFixImports(options);
    });

  return command;
}

async function executeFixImports(options: {
  list?: boolean;
  auto?: boolean;
}): Promise<void> {
  logger.startSpinner("Analyzing import errors...");

  const analysis = importsService.analyzeImportErrors();
  const totalErrors = analysis.fixable.length + analysis.unfixable.length;

  if (totalErrors === 0) {
    logger.succeedSpinner("No import errors found!");
    return;
  }

  logger.succeedSpinner(
    `Found ${totalErrors} import errors (${analysis.fixable.length} fixable, ${analysis.unfixable.length} unfixable)`
  );

  logger.newLine();

  // Show unfixable errors
  if (analysis.unfixable.length > 0) {
    logger.log(logger.bold(logger.warning("Unfixable errors:")));
    logger.newLine();

    const unfixableTable = new Table({
      head: [logger.bold("File"), logger.bold("Line"), logger.bold("Missing"), logger.bold("Reason")],
      style: { head: [], border: [] },
      colWidths: [30, 6, 15, 40],
      wordWrap: true,
    });

    for (const item of analysis.unfixable.slice(0, 10)) {
      const filePath = item.error.file.split("/").slice(-2).join("/");
      unfixableTable.push([
        logger.muted(filePath),
        logger.muted(String(item.error.line)),
        logger.warning(item.error.missingName),
        logger.muted(item.reason),
      ]);
    }

    console.log(unfixableTable.toString());

    if (analysis.unfixable.length > 10) {
      logger.log(logger.muted(`... and ${analysis.unfixable.length - 10} more unfixable errors`));
    }

    logger.newLine();
  }

  // Show and handle fixable errors
  if (analysis.fixable.length === 0) {
    logger.infoLog("No fixable import errors found");
    return;
  }

  logger.log(logger.bold(logger.secondary("Fixable errors:")));
  logger.newLine();

  const fixableTable = new Table({
    head: [logger.bold("File"), logger.bold("Line"), logger.bold("Missing"), logger.bold("Candidates")],
    style: { head: [], border: [] },
    colWidths: [30, 6, 15, 40],
    wordWrap: true,
  });

  for (const item of analysis.fixable.slice(0, 15)) {
    const filePath = item.error.file.split("/").slice(-2).join("/");
    const candidateNames = item.candidates
      .slice(0, 3)
      .map((c) => `${c.name} (${c.filePath.split("/").slice(-1)[0]})`)
      .join(", ");
    const moreText = item.candidates.length > 3 ? ` +${item.candidates.length - 3} more` : "";

    fixableTable.push([
      logger.muted(filePath),
      logger.muted(String(item.error.line)),
      logger.secondary(item.error.missingName),
      candidateNames + moreText,
    ]);
  }

  console.log(fixableTable.toString());

  if (analysis.fixable.length > 15) {
    logger.log(logger.muted(`... and ${analysis.fixable.length - 15} more fixable errors`));
  }

  logger.newLine();

  if (options.list) {
    return;
  }

  // Auto-fix mode
  if (options.auto) {
    const autoFixable = analysis.fixable.filter((f) => f.candidates.length === 1);

    if (autoFixable.length === 0) {
      logger.infoLog("No single-candidate imports to auto-fix");
      return;
    }

    const confirm = await vimConfirm({
      message: `Auto-fix ${autoFixable.length} imports with single candidates?`,
      default: true,
    });

    if (!confirm) {
      logger.infoLog("Cancelled");
      return;
    }

    logger.startSpinner("Fixing imports...");
    const result = importsService.fixMultiple(autoFixable);
    logger.succeedSpinner(`Fixed ${result.fixed} imports`);

    if (result.failed > 0) {
      logger.warning(`${result.failed} imports could not be fixed`);
    }

    return;
  }

  // Interactive mode
  await interactiveFixImports(analysis.fixable);
}

async function interactiveFixImports(fixable: FixableImport[]): Promise<void> {
  const action = await vimSelect<"all" | "select" | "cancel">({
    message: "How would you like to proceed?",
    choices: [
      { name: "Fix all (will prompt for multiple candidates)", value: "all" },
      { name: "Select which errors to fix", value: "select" },
      { name: "Cancel", value: "cancel" },
    ],
  });

  if (action === "cancel") {
    logger.infoLog("Cancelled");
    return;
  }

  let toFix: FixableImport[];

  if (action === "select") {
    // Let user select which files to fix
    const fileErrors = new Map<string, FixableImport[]>();
    for (const fix of fixable) {
      const existing = fileErrors.get(fix.error.file) || [];
      existing.push(fix);
      fileErrors.set(fix.error.file, existing);
    }

    const fileChoices = Array.from(fileErrors.entries()).map(([file, fixes]) => ({
      name: `${file.split("/").slice(-2).join("/")} (${fixes.length} errors)`,
      value: file,
    }));

    logger.newLine();
    logger.infoLog("Select files to fix (space to toggle, enter to confirm):");
    logger.newLine();

    // Use entity navigator for multi-select
    const entities = Array.from(fileErrors.keys()).map((file, idx) => ({
      name: file.split("/").slice(-1)[0],
      kind: "variable" as const,
      filePath: file,
      line: fileErrors.get(file)!.length,
      column: 0,
      isExported: true,
      node: null as any,
      sourceFile: null as any,
    }));

    const navResult = await navigateEntities({
      items: entities,
      showBody: false,
      multiSelect: true,
      title: "Select files to fix",
    });

    if (navResult.cancelled || navResult.selected.length === 0) {
      logger.infoLog("Cancelled");
      return;
    }

    const selectedFiles = new Set(navResult.selected.map((e) => e.filePath));
    toFix = fixable.filter((f) => selectedFiles.has(f.error.file));
  } else {
    toFix = fixable;
  }

  // Process each fix
  let fixed = 0;
  let skipped = 0;

  for (const fix of toFix) {
    const filePath = fix.error.file.split("/").slice(-2).join("/");

    if (fix.candidates.length === 1) {
      // Single candidate - just confirm
      fix.selectedCandidate = fix.candidates[0];
      const candidatePath = fix.selectedCandidate.filePath.split("/").slice(-2).join("/");

      logger.newLine();
      logger.log(
        `${logger.muted(filePath + ":" + fix.error.line)} - Import ${logger.primary(fix.error.missingName)} from ${logger.secondary(candidatePath)}`
      );

      const confirm = await vimConfirm({
        message: "Apply this fix?",
        default: true,
      });

      if (confirm) {
        if (importsService.fixImport(fix)) {
          fixed++;
        }
      } else {
        skipped++;
      }
    } else {
      // Multiple candidates - let user choose
      logger.newLine();
      logger.log(
        `${logger.muted(filePath + ":" + fix.error.line)} - Multiple candidates for ${logger.primary(fix.error.missingName)}`
      );

      const navResult = await navigateEntities({
        items: fix.candidates,
        showBody: false,
        multiSelect: false,
        title: `Select source for "${fix.error.missingName}"`,
      });

      if (navResult.cancelled || navResult.selected.length === 0) {
        skipped++;
        continue;
      }

      fix.selectedCandidate = navResult.selected[0];

      if (importsService.fixImport(fix)) {
        fixed++;
      }
    }
  }

  // Save all changes
  const project = (await import("../../core/project.js")).getProjectInstance();
  project.saveAll();

  logger.newLine();
  logger.success(`Fixed ${fixed} imports, skipped ${skipped}`);
}
