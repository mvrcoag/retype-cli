#!/usr/bin/env node

import { Command } from "commander";
import Table from "cli-table3";
import { initializeProject, getProjectInstance } from "../core/project.js";
import { logger } from "../utils/logger.js";
import { navigateEntities } from "../utils/navigator.js";
import {
  vimSelect,
  vimInput,
  vimConfirm,
  setupGracefulExit,
  isExitError,
} from "../utils/prompts.js";
import { pathInput } from "../utils/path-input.js";
import {
  APP_AUTHOR,
  APP_DESCRIPTION,
  APP_NAME,
  APP_VERSION,
  ENTITY_KINDS,
  ICONS,
} from "../constants/index.js";
import { createSearchCommand } from "./commands/search.js";
import { createRenameCommand } from "./commands/rename.js";
import { createExtractCommand } from "./commands/extract.js";
import { createUnusedCommand } from "./commands/unused.js";
import { createReferencesCommand } from "./commands/references.js";
import { createFixImportsCommand } from "./commands/fix-imports.js";
import { searchService } from "../services/search.service.js";
import { renameService } from "../services/rename.service.js";
import { extractService } from "../services/extract.service.js";
import { unusedService } from "../services/unused.service.js";
import { referencesService } from "../services/references.service.js";
import { importsService, FixableImport } from "../services/imports.service.js";
import { EntityKind, Entity } from "../types/index.js";

setupGracefulExit();

const program = new Command();

program
  .name(APP_NAME.toLowerCase())
  .version(APP_VERSION)
  .description(APP_DESCRIPTION)
  .option("-p, --path <path>", "Project root path", process.cwd())
  .option("-c, --config <path>", "Path to tsconfig.json")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();

    if (!opts.quiet) {
      logger.banner();
    }

    try {
      logger.startSpinner("Loading project...");
      const project = initializeProject({
        rootPath: opts.path,
        tsConfigPath: opts.config,
      });
      logger.succeedSpinner(`Loaded ${project.getFileCount()} source files`);
      logger.newLine();
    } catch (error) {
      logger.failSpinner("Failed to load project");
      logger.errorLog(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.addCommand(createSearchCommand());
program.addCommand(createRenameCommand());
program.addCommand(createExtractCommand());
program.addCommand(createUnusedCommand());
program.addCommand(createReferencesCommand());
program.addCommand(createFixImportsCommand());

program
  .command("interactive", { isDefault: true })
  .alias("i")
  .description("Start interactive mode")
  .action(async () => {
    try {
      await mainMenu();
    } catch (error) {
      if (isExitError(error)) {
        logger.newLine();
        logger.infoLog("Cancelled. Goodbye!");
        process.exit(0);
      }
      throw error;
    }
  });

type MenuAction =
  | "search"
  | "rename"
  | "extract"
  | "unused"
  | "references"
  | "fix-imports"
  | "exit";

async function mainMenu(): Promise<void> {
  let running = true;

  while (running) {
    logger.log(logger.muted("  j/k: navigate  enter: select  q: quit"));
    logger.newLine();

    const action = await vimSelect<MenuAction>({
      message: "What would you like to do?",
      choices: [
        { name: "Search for entities", value: "search" },
        { name: "Rename entities", value: "rename" },
        { name: "Extract entity to file", value: "extract" },
        { name: "Find unused entities", value: "unused" },
        { name: "Find entity references", value: "references" },
        { name: "Fix missing imports", value: "fix-imports" },
        { name: "Exit", value: "exit" },
      ],
    });

    logger.newLine();

    switch (action) {
      case "search":
        await interactiveSearch();
        break;
      case "rename":
        await interactiveRename();
        break;
      case "extract":
        await interactiveExtract();
        break;
      case "unused":
        await interactiveUnused();
        break;
      case "references":
        await interactiveReferences();
        break;
      case "fix-imports":
        await interactiveFixImports();
        break;
      case "exit":
        running = false;
        logger.success("Goodbye!");
        break;
    }

    if (running) {
      logger.newLine();
    }
  }
}

async function interactiveSearch(): Promise<void> {
  const name = await vimInput({
    message: "Search term (leave empty for all):",
  });

  const kindChoices = [
    { name: "All kinds", value: "" },
    ...ENTITY_KINDS.map((k) => ({ name: k, value: k })),
  ];

  const kind = await vimSelect({
    message: "Filter by kind:",
    choices: kindChoices,
  });

  const exportedOnly = await vimConfirm({
    message: "Only exported?",
    default: false,
  });

  logger.startSpinner("Searching...");

  const result = searchService.search({
    name: name || undefined,
    kind: (kind || undefined) as EntityKind | undefined,
    exported: exportedOnly ? true : undefined,
  });

  logger.succeedSpinner(`Found ${result.entities.length} entities`);

  if (result.entities.length === 0) {
    return;
  }

  logger.newLine();

  const navResult = await navigateEntities({
    items: result.entities,
    showBody: false,
    multiSelect: false,
    title: "Search Results",
  });

  if (!navResult.cancelled && navResult.selected.length > 0) {
    const entity = navResult.selected[0];
    logger.newLine();
    logger.success(`Selected: ${entity.name}`);
    logger.log(
      `  ${logger.muted("File:")} ${logger.filePath(entity.filePath)}`,
    );
    logger.log(`  ${logger.muted("Line:")} ${entity.line}`);
  }
}

async function interactiveRename(): Promise<void> {
  const searchTerm = await vimInput({
    message: "Search for entity to rename:",
    validate: (value) => (value.trim() ? true : "Search term is required"),
  });

  logger.startSpinner("Searching...");

  const result = searchService.search({ name: searchTerm });

  if (result.entities.length === 0) {
    logger.failSpinner(`No entities found matching "${searchTerm}"`);
    return;
  }

  logger.succeedSpinner(`Found ${result.entities.length} matching entities`);

  let entitiesToRename: Entity[];

  if (result.entities.length === 1) {
    entitiesToRename = result.entities;
    const entity = entitiesToRename[0];
    logger.success(
      `Found ${entity.kind} "${entity.name}" in ${logger.filePath(entity.filePath)}`,
    );
  } else {
    logger.newLine();
    logger.infoLog("Multiple matches found. Select entities to rename:");
    logger.newLine();

    const navResult = await navigateEntities({
      items: result.entities,
      showBody: false,
      multiSelect: true,
      title: "Select entities to rename",
    });

    if (navResult.cancelled || navResult.selected.length === 0) {
      logger.infoLog("Operation cancelled");
      return;
    }

    entitiesToRename = navResult.selected;
    logger.newLine();
    logger.success(`Selected ${entitiesToRename.length} entities to rename:`);
    entitiesToRename.forEach((e, i) => {
      const relativePath = e.filePath.split("/").slice(-2).join("/");
      logger.log(
        `  ${logger.muted(`${i + 1}.`)} ${logger.entityIcon(e.kind)} ${logger.primary(e.name)} ${logger.muted(`(${relativePath}:${e.line})`)}`,
      );
    });
  }

  const total = entitiesToRename.length;

  for (let i = 0; i < entitiesToRename.length; i++) {
    const entity = entitiesToRename[i];
    const progress = total > 1 ? `[${i + 1}/${total}] ` : "";
    const relativePath = entity.filePath.split("/").slice(-2).join("/");

    logger.newLine();
    logger.log(
      logger.bold(`${progress}Entity: `) +
        logger.entityIcon(entity.kind) +
        ` ${logger.primary(entity.name)} ` +
        logger.muted(`(${relativePath}:${entity.line})`),
    );

    const newName = await vimInput({
      message: `${progress}New name for "${entity.name}":`,
      validate: (value) => {
        if (!value.trim()) return "Name is required";
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value))
          return "Invalid identifier";
        return true;
      },
    });

    logger.startSpinner("Analyzing references...");
    const preview = renameService.previewRename(entity);
    logger.succeedSpinner(`Found ${preview.length} references`);

    if (preview.length > 0) {
      logger.newLine();
      logger.log(logger.bold("References to be updated:"));
      logger.newLine();

      const table = new Table({
        head: [logger.bold("File"), logger.bold("Line"), logger.bold("Code")],
        style: { head: [], border: [] },
        colWidths: [35, 8, 50],
        wordWrap: true,
      });

      for (const ref of preview.slice(0, 10)) {
        const refPath = ref.file.split("/").slice(-2).join("/");
        table.push([
          logger.muted(refPath),
          logger.muted(String(ref.line)),
          ref.text.length > 45 ? ref.text.substring(0, 45) + "..." : ref.text,
        ]);
      }

      console.log(table.toString());

      if (preview.length > 10) {
        logger.log(
          logger.muted(`... and ${preview.length - 10} more references`),
        );
      }
    }

    logger.newLine();
    const shouldProceed = await vimConfirm({
      message: `${progress}Rename "${entity.name}" ${ICONS.arrow} "${newName}"?`,
      default: true,
    });

    if (!shouldProceed) {
      logger.infoLog(`Skipped "${entity.name}"`);
      continue;
    }

    logger.startSpinner("Renaming...");
    const renameResult = renameService.rename(entity, newName);
    logger.succeedSpinner(
      `Renamed "${renameResult.oldName}" ${ICONS.arrow} "${renameResult.newName}" (${renameResult.referencesUpdated} references)`,
    );
  }
}

async function interactiveExtract(): Promise<void> {
  const searchTerm = await vimInput({
    message: "Search for entity to extract:",
    validate: (value) => (value.trim() ? true : "Search term is required"),
  });

  logger.startSpinner("Searching...");

  const result = searchService.search({ name: searchTerm });

  if (result.entities.length === 0) {
    logger.failSpinner(`No entities found matching "${searchTerm}"`);
    return;
  }

  logger.succeedSpinner(`Found ${result.entities.length} matching entities`);

  let entity: Entity;

  if (result.entities.length === 1) {
    entity = result.entities[0];
    logger.success(
      `Found ${entity.kind} "${entity.name}" in ${logger.filePath(entity.filePath)}`,
    );
  } else {
    logger.newLine();
    logger.infoLog("Multiple matches found. Select entity to extract:");
    logger.newLine();

    const navResult = await navigateEntities({
      items: result.entities,
      showBody: false,
      multiSelect: false,
      title: "Select entity to extract",
    });

    if (navResult.cancelled || navResult.selected.length === 0) {
      logger.infoLog("Operation cancelled");
      return;
    }

    entity = navResult.selected[0];
    logger.newLine();
    logger.success(
      `Selected ${entity.kind} "${entity.name}" in ${logger.filePath(entity.filePath)}`,
    );
  }

  const targetPath = await pathInput({
    message: "Target file path:",
    initialPath: "src/",
    validate: (value) => {
      if (!value.trim()) return "Path is required";
      if (!value.endsWith(".ts") && !value.endsWith(".tsx"))
        return "Must be .ts or .tsx file";
      return true;
    },
  });

  logger.newLine();
  logger.log(logger.bold("Extraction Summary:"));
  logger.log(
    `  ${logger.muted("Entity:")} ${logger.entityIcon(entity.kind)} ${logger.primary(entity.name)}`,
  );
  logger.log(`  ${logger.muted("From:")} ${logger.filePath(entity.filePath)}`);
  logger.log(`  ${logger.muted("To:")} ${logger.filePath(targetPath)}`);

  logger.startSpinner("Analyzing references...");
  const refs = referencesService.findEntityReferences(entity);
  logger.succeedSpinner(`Found ${refs.referencedIn.length} references`);

  if (refs.referencedIn.length > 0) {
    logger.newLine();
    logger.log(logger.bold("Files that import this entity (will be updated):"));
    logger.newLine();

    const table = new Table({
      head: [logger.bold("File"), logger.bold("Line"), logger.bold("Usage")],
      style: { head: [], border: [] },
      colWidths: [40, 8, 45],
      wordWrap: true,
    });

    const uniqueFiles = new Map<string, { line: number; text: string }>();
    for (const ref of refs.referencedIn) {
      if (!uniqueFiles.has(ref.file)) {
        uniqueFiles.set(ref.file, { line: ref.line, text: ref.text });
      }
    }

    let count = 0;
    for (const [file, info] of uniqueFiles) {
      if (count >= 8) break;
      const refPath = file.split("/").slice(-2).join("/");
      table.push([
        logger.muted(refPath),
        logger.muted(String(info.line)),
        info.text.length > 40 ? info.text.substring(0, 40) + "..." : info.text,
      ]);
      count++;
    }

    console.log(table.toString());

    if (uniqueFiles.size > 8) {
      logger.log(logger.muted(`... and ${uniqueFiles.size - 8} more files`));
    }
  }

  logger.newLine();
  const shouldProceed = await vimConfirm({
    message: "Proceed with extraction?",
    default: true,
  });

  if (!shouldProceed) {
    logger.infoLog("Cancelled");
    return;
  }

  logger.startSpinner("Extracting...");
  const extractResult = extractService.extract(entity, targetPath);
  logger.succeedSpinner(
    `Extracted "${extractResult.entityName}" to ${extractResult.targetPath}`,
  );

  if (extractResult.importsUpdated.length > 0) {
    logger.newLine();
    logger.log(logger.bold("Updated imports in:"));
    for (const file of extractResult.importsUpdated.slice(0, 5)) {
      const relativePath = file.split("/").slice(-2).join("/");
      logger.log(`  ${logger.muted("-")} ${relativePath}`);
    }
    if (extractResult.importsUpdated.length > 5) {
      logger.log(
        logger.muted(
          `  ... and ${extractResult.importsUpdated.length - 5} more`,
        ),
      );
    }
  }
}

async function interactiveUnused(): Promise<void> {
  logger.startSpinner("Analyzing...");
  const results = unusedService.findUnused();
  logger.succeedSpinner(`Found ${results.length} unused entities`);

  if (results.length === 0) {
    logger.success("No unused entities found!");
    return;
  }

  logger.newLine();

  const entities = results.map((r) => r.entity);
  const navResult = await navigateEntities({
    items: entities,
    showBody: false,
    multiSelect: false,
    title: "Unused Entities",
  });

  if (!navResult.cancelled && navResult.selected.length > 0) {
    const entity = navResult.selected[0];
    const unusedInfo = results.find((r) => r.entity === entity);
    logger.newLine();
    logger.log(`${logger.warning(entity.name)}`);
    logger.log(`  ${logger.muted("Kind:")} ${entity.kind}`);
    logger.log(
      `  ${logger.muted("File:")} ${logger.filePath(entity.filePath)}`,
    );
    logger.log(`  ${logger.muted("Line:")} ${entity.line}`);
    if (unusedInfo) {
      logger.log(`  ${logger.muted("Reason:")} ${unusedInfo.reason}`);
    }
  }
}

async function interactiveReferences(): Promise<void> {
  const searchTerm = await vimInput({
    message: "Search for entity to find references:",
    validate: (value) => (value.trim() ? true : "Search term is required"),
  });

  logger.startSpinner("Searching...");

  const result = searchService.search({ name: searchTerm });

  if (result.entities.length === 0) {
    logger.failSpinner(`No entities found matching "${searchTerm}"`);
    return;
  }

  logger.succeedSpinner(`Found ${result.entities.length} matching entities`);

  let entitiesToAnalyze: Entity[];

  if (result.entities.length === 1) {
    entitiesToAnalyze = result.entities;
    const entity = entitiesToAnalyze[0];
    logger.success(
      `Found ${entity.kind} "${entity.name}" in ${logger.filePath(entity.filePath)}`,
    );
  } else {
    logger.newLine();
    logger.infoLog("Multiple matches found. Select entities to analyze:");
    logger.newLine();

    const navResult = await navigateEntities({
      items: result.entities,
      showBody: false,
      multiSelect: true,
      title: "Select entities to find references",
    });

    if (navResult.cancelled || navResult.selected.length === 0) {
      logger.infoLog("Operation cancelled");
      return;
    }

    entitiesToAnalyze = navResult.selected;
    logger.newLine();
    logger.success(`Selected ${entitiesToAnalyze.length} entities to analyze`);
  }

  for (const entity of entitiesToAnalyze) {
    logger.newLine();
    const relativePath = entity.filePath.split("/").slice(-2).join("/");
    logger.log(
      logger.bold("Entity: ") +
        logger.entityIcon(entity.kind) +
        ` ${logger.primary(entity.name)} ` +
        logger.muted(`(${relativePath}:${entity.line})`),
    );

    logger.startSpinner("Analyzing references...");
    const refs = referencesService.findEntityReferences(entity);
    logger.succeedSpinner(`Found ${refs.referencedIn.length} references`);

    if (refs.referencedIn.length === 0) {
      logger.infoLog("No references found for this entity");
      continue;
    }

    logger.newLine();

    const table = new Table({
      head: [logger.bold("File"), logger.bold("Line"), logger.bold("Usage")],
      style: { head: [], border: [] },
      colWidths: [40, 8, 45],
      wordWrap: true,
    });

    for (const ref of refs.referencedIn.slice(0, 15)) {
      const refPath = ref.file.split("/").slice(-2).join("/");
      table.push([
        logger.muted(refPath),
        logger.muted(String(ref.line)),
        ref.text.length > 40 ? ref.text.substring(0, 40) + "..." : ref.text,
      ]);
    }

    console.log(table.toString());

    if (refs.referencedIn.length > 15) {
      logger.log(
        logger.muted(
          `... and ${refs.referencedIn.length - 15} more references`,
        ),
      );
    }
  }
}

async function interactiveFixImports(): Promise<void> {
  logger.startSpinner("Analyzing import errors...");

  const analysis = importsService.analyzeImportErrors();
  const totalErrors = analysis.fixable.length + analysis.unfixable.length;

  if (totalErrors === 0) {
    logger.succeedSpinner("No import errors found!");
    return;
  }

  logger.succeedSpinner(
    `Found ${totalErrors} import errors (${analysis.fixable.length} fixable, ${analysis.unfixable.length} unfixable)`,
  );

  logger.newLine();

  // Show unfixable errors
  if (analysis.unfixable.length > 0) {
    logger.log(logger.bold(logger.warning("Unfixable errors:")));
    logger.newLine();

    const unfixableTable = new Table({
      head: [
        logger.bold("File"),
        logger.bold("Line"),
        logger.bold("Missing"),
        logger.bold("Reason"),
      ],
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
      logger.log(
        logger.muted(
          `... and ${analysis.unfixable.length - 10} more unfixable errors`,
        ),
      );
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
    head: [
      logger.bold("File"),
      logger.bold("Line"),
      logger.bold("Missing"),
      logger.bold("Candidates"),
    ],
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
    const moreText =
      item.candidates.length > 3 ? ` +${item.candidates.length - 3} more` : "";

    fixableTable.push([
      logger.muted(filePath),
      logger.muted(String(item.error.line)),
      logger.secondary(item.error.missingName),
      candidateNames + moreText,
    ]);
  }

  console.log(fixableTable.toString());

  if (analysis.fixable.length > 15) {
    logger.log(
      logger.muted(`... and ${analysis.fixable.length - 15} more fixable errors`),
    );
  }

  logger.newLine();

  // Interactive mode - ask how to proceed
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
    // Group by file for selection
    const fileErrors = new Map<string, FixableImport[]>();
    for (const fix of analysis.fixable) {
      const existing = fileErrors.get(fix.error.file) || [];
      existing.push(fix);
      fileErrors.set(fix.error.file, existing);
    }

    const entities = Array.from(fileErrors.keys()).map((file) => ({
      name: file.split("/").slice(-1)[0],
      kind: "variable" as const,
      filePath: file,
      line: fileErrors.get(file)!.length,
      column: 0,
      isExported: true,
      node: null as any,
      sourceFile: null as any,
    }));

    logger.newLine();

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
    toFix = analysis.fixable.filter((f) => selectedFiles.has(f.error.file));
  } else {
    toFix = analysis.fixable;
  }

  // Process each fix
  let fixed = 0;
  let skipped = 0;

  for (const fix of toFix) {
    const filePath = fix.error.file.split("/").slice(-2).join("/");

    if (fix.candidates.length === 1) {
      // Single candidate - just confirm
      fix.selectedCandidate = fix.candidates[0];
      const candidatePath = fix.selectedCandidate.filePath
        .split("/")
        .slice(-2)
        .join("/");

      logger.newLine();
      logger.log(
        `${logger.muted(filePath + ":" + fix.error.line)} - Import ${logger.primary(fix.error.missingName)} from ${logger.secondary(candidatePath)}`,
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
        `${logger.muted(filePath + ":" + fix.error.line)} - Multiple candidates for ${logger.primary(fix.error.missingName)}`,
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
  const project = getProjectInstance();
  project.saveAll();

  logger.newLine();
  logger.success(`Fixed ${fixed} imports, skipped ${skipped}`);
}

program.parse();
