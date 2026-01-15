import { Command } from "commander";
import { input, confirm } from "@inquirer/prompts";
import Table from "cli-table3";
import { renameService } from "../../services/rename.service.js";
import { searchService } from "../../services/search.service.js";
import { navigateEntities } from "../../utils/navigator.js";
import { logger } from "../../utils/logger.js";
import { Entity } from "../../types/index.js";

export function createRenameCommand(): Command {
  const command = new Command("rename")
    .alias("r")
    .description("Rename an entity across the codebase")
    .argument("<searchTerm>", "Search term to find entity (partial match)")
    .argument("[newName]", "New name for the entity")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("-p, --preview", "Preview changes without applying")
    .option("-b, --body", "Show code body when selecting")
    .option("-e, --exact", "Use exact match instead of partial")
    .action(async (searchTerm: string, newName: string | undefined, options) => {
      await executeRename(searchTerm, newName, options);
    });

  return command;
}

async function executeRename(
  searchTerm: string,
  newName: string | undefined,
  options: { yes?: boolean; preview?: boolean; body?: boolean; exact?: boolean }
): Promise<void> {
  logger.startSpinner(`Searching for "${searchTerm}"...`);

  try {
    const result = searchService.search({
      name: searchTerm,
      regex: !options.exact,
    });

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
        `Found ${entity.kind} "${entity.name}" in ${logger.filePath(entity.filePath)}`
      );
    } else {
      logger.newLine();
      logger.infoLog("Multiple matches found. Select entities to rename:");
      logger.newLine();

      const navResult = await navigateEntities({
        items: result.entities,
        showBody: options.body ?? false,
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
          `  ${logger.muted(`${i + 1}.`)} ${logger.entityIcon(e.kind)} ${logger.primary(e.name)} ${logger.muted(`(${relativePath}:${e.line})`)}`
        );
      });
    }

    let targetName = newName;
    if (!targetName) {
      logger.newLine();
      targetName = await input({
        message: "Enter new name:",
        validate: (value) => {
          if (!value.trim()) {
            return "Name cannot be empty";
          }
          if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value)) {
            return "Invalid identifier name";
          }
          return true;
        },
      });
    }

    const total = entitiesToRename.length;
    let completed = 0;
    let skipped = 0;

    for (let i = 0; i < entitiesToRename.length; i++) {
      const entity = entitiesToRename[i];
      const progress = total > 1 ? `[${i + 1}/${total}] ` : "";
      const relativePath = entity.filePath.split("/").slice(-2).join("/");

      logger.newLine();
      logger.log(
        logger.bold(`${progress}Renaming: `) +
          logger.primary(entity.name) +
          logger.muted(` → `) +
          logger.secondary(targetName!) +
          logger.muted(` (${relativePath}:${entity.line})`)
      );

      logger.startSpinner("Analyzing references...");
      const preview = renameService.previewRename(entity);
      logger.succeedSpinner(`Found ${preview.length} references`);

      if (preview.length > 0 && !options.yes) {
        logger.newLine();
        logger.log(logger.bold("References to be updated:"));
        logger.newLine();

        const table = new Table({
          head: [logger.bold("File"), logger.bold("Line"), logger.bold("Code")],
          style: { head: [], border: [] },
          colWidths: [40, 8, 60],
          wordWrap: true,
        });

        for (const ref of preview.slice(0, 15)) {
          const refPath = ref.file.split("/").slice(-2).join("/");
          table.push([
            logger.muted(refPath),
            logger.muted(String(ref.line)),
            ref.text.length > 55 ? ref.text.substring(0, 55) + "..." : ref.text,
          ]);
        }

        console.log(table.toString());

        if (preview.length > 15) {
          logger.log(logger.muted(`... and ${preview.length - 15} more references`));
        }
      }

      if (options.preview) {
        logger.newLine();
        logger.infoLog("Preview mode - no changes applied");
        continue;
      }

      if (!options.yes) {
        logger.newLine();
        const shouldProceed = await confirm({
          message: `${progress}Rename "${entity.name}" to "${targetName}"?`,
          default: true,
        });

        if (!shouldProceed) {
          logger.infoLog(`Skipped "${entity.name}"`);
          skipped++;
          continue;
        }
      }

      logger.startSpinner("Renaming...");
      const renameResult = renameService.rename(entity, targetName!);
      logger.succeedSpinner(
        `Renamed "${renameResult.oldName}" → "${renameResult.newName}" (${renameResult.referencesUpdated} refs, ${renameResult.filesModified.length} files)`
      );
      completed++;
    }

    if (!options.preview && total > 1) {
      logger.newLine();
      logger.box(
        "Rename Summary",
        `${logger.muted("Total selected:")} ${total}\n` +
          `${logger.muted("Completed:")} ${logger.secondary(String(completed))}\n` +
          `${logger.muted("Skipped:")} ${skipped > 0 ? logger.warning(String(skipped)) : "0"}\n` +
          `${logger.muted("New name:")} ${logger.secondary(targetName!)}`
      );
    }
  } catch (error) {
    logger.failSpinner("Rename failed");
    logger.errorLog(error instanceof Error ? error.message : String(error));
  }
}
